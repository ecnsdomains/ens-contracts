/**
 * Register multiple test names and extract SVGs for gallery preview.
 * Runs after deploy-renderer.ts has set up the new contracts.
 */
import { createWalletClient, createPublicClient, http, keccak256, toHex, labelhash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as fs from 'fs'
import * as path from 'path'

const mordor = {
  id: 63,
  name: 'Mordor',
  nativeCurrency: { name: 'Mordor Ether', symbol: 'METC', decimals: 18 },
  rpcUrls: { default: { http: ['http://localhost:8545'] } },
  testnet: true,
} as const

const CONTRACTS_DIR = '/media/dev/2tb/dev/ecns/contracts'

const testNames = [
  'alice',      // 5-char, Pure Alpha
  'h4ck3r',    // 6-char, Leetspeak
  'bob',        // 3-char short, Pure Alpha
  'xyz',        // 3-char, Pure Alpha
  '0x42',       // 4-char, Hex (starts with 0x)
  'vitalik',    // 7-char, Pure Alpha
  'etc',        // 3-char, Pure Alpha
  'phantom',    // 7-char, Pure Alpha
  'ab',         // 2-char Ultra Rare
  'z',          // 1-char Ultra Rare
]

async function main() {
  const privateKey = process.env.DEPLOYER_KEY
  if (!privateKey) throw new Error('DEPLOYER_KEY not set')

  const account = privateKeyToAccount(`0x${privateKey}`)
  const publicClient = createPublicClient({ chain: mordor, transport: http() })
  const walletClient = createWalletClient({ account, chain: mordor, transport: http() })

  const deploymentsPath = path.join(CONTRACTS_DIR, 'deployments/mordor.json')
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'))

  const artifactsDir = path.join(CONTRACTS_DIR, 'artifacts/contracts')
  const loadArtifact = (p: string, n: string) =>
    JSON.parse(fs.readFileSync(path.join(artifactsDir, p, `${n}.json`), 'utf8'))

  const controllerAddr = deployments.contracts.ETCRegistrarController as `0x${string}`
  const baseAddr = deployments.contracts.BaseRegistrar as `0x${string}`
  const resolverAddr = deployments.contracts.PublicResolver as `0x${string}`
  const reverseAddr = deployments.contracts.ReverseRegistrar as `0x${string}`

  const controllerAbi = loadArtifact('etcregistrar/ETCRegistrarController.sol', 'ETCRegistrarController').abi
  const baseAbi = loadArtifact('etcregistrar/BaseRegistrarImplementation.sol', 'BaseRegistrarImplementation').abi

  const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`
  const duration = BigInt(365 * 24 * 60 * 60)

  const svgDir = path.join(CONTRACTS_DIR, 'svg-prototype')
  if (!fs.existsSync(svgDir)) fs.mkdirSync(svgDir, { recursive: true })

  // Phase 1: Commit all names
  console.log('=== COMMITTING ALL NAMES ===')
  const commitments: { name: string; secret: `0x${string}`; total: bigint }[] = []

  for (const name of testNames) {
    const secret = keccak256(toHex(`gallery-${name}-${Date.now()}`))
    const reg = {
      label: name,
      owner: account.address,
      duration,
      secret,
      resolver: resolverAddr,
      data: [] as `0x${string}`[],
      reverseRecord: 0,
      referrer: ZERO_BYTES32,
    }

    try {
      const price = await publicClient.readContract({
        address: controllerAddr, abi: controllerAbi,
        functionName: 'rentPrice', args: [name, duration],
      }) as { base: bigint; premium: bigint }
      const total = price.base + price.premium

      const commitment = await publicClient.readContract({
        address: controllerAddr, abi: controllerAbi,
        functionName: 'makeCommitment', args: [reg],
      }) as `0x${string}`

      await publicClient.waitForTransactionReceipt({
        hash: await walletClient.writeContract({
          address: controllerAddr, abi: controllerAbi,
          functionName: 'commit', args: [commitment],
        }),
      })

      commitments.push({ name, secret, total })
      console.log(`  ${name}.etc committed (${Number(total) / 1e18} METC)`)
    } catch (e: any) {
      console.log(`  ${name}.etc SKIP: ${e.message?.slice(0, 100)}`)
    }
  }

  // Phase 2: Wait for minCommitmentAge
  console.log('\nWaiting 70s for minCommitmentAge...')
  await new Promise(r => setTimeout(r, 70000))

  // Phase 3: Register all names
  console.log('\n=== REGISTERING ALL NAMES ===')
  for (const { name, secret, total } of commitments) {
    const reg = {
      label: name,
      owner: account.address,
      duration,
      secret,
      resolver: resolverAddr,
      data: [] as `0x${string}`[],
      reverseRecord: 0,
      referrer: ZERO_BYTES32,
    }

    try {
      await publicClient.waitForTransactionReceipt({
        hash: await walletClient.writeContract({
          address: controllerAddr, abi: controllerAbi,
          functionName: 'register', args: [reg],
          value: total + total / 10n,
        }),
      })
      console.log(`  ${name}.etc registered`)
    } catch (e: any) {
      console.log(`  ${name}.etc FAILED: ${e.message?.slice(0, 100)}`)
    }
  }

  // Phase 4: Extract SVGs
  console.log('\n=== EXTRACTING SVGs ===')
  const allNames = ['holographic', ...commitments.map(c => c.name)]
  const gallery: { name: string; svg: string; tier: string; charClass: string }[] = []

  for (const name of allNames) {
    const tokenId = BigInt(labelhash(name))
    try {
      const uri = await publicClient.readContract({
        address: baseAddr, abi: baseAbi,
        functionName: 'tokenURI', args: [tokenId],
      }) as string

      const jsonB64 = uri.replace('data:application/json;base64,', '')
      const meta = JSON.parse(Buffer.from(jsonB64, 'base64').toString())

      const svg = meta.image?.startsWith('data:image/svg+xml;base64,')
        ? Buffer.from(meta.image.replace('data:image/svg+xml;base64,', ''), 'base64').toString()
        : ''

      const tier = meta.attributes?.find((a: any) => a.trait_type === 'Tier')?.value || ''
      const charClass = meta.attributes?.find((a: any) => a.trait_type === 'Character Class')?.value || ''

      fs.writeFileSync(path.join(svgDir, `${name}.svg`), svg)
      gallery.push({ name, svg: `${name}.svg`, tier, charClass })
      console.log(`  ${name}.etc → ${svg.length} chars (${tier}, ${charClass})`)
    } catch (e: any) {
      console.log(`  ${name}.etc ERROR: ${e.message?.slice(0, 100)}`)
    }
  }

  // Phase 5: Generate HTML gallery
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>ECNS NFT Gallery — Phase 3j Preview</title>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@200;400;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0a;
      color: #4FD4A4;
      font-family: 'IBM Plex Mono', monospace;
      padding: 40px;
    }
    h1 { font-size: 24px; margin-bottom: 8px; letter-spacing: 3px; }
    .subtitle { color: rgba(63,182,139,0.5); font-size: 12px; margin-bottom: 40px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 32px;
    }
    .card {
      background: #111;
      border: 1px solid rgba(63,182,139,0.15);
      border-radius: 16px;
      overflow: hidden;
      transition: border-color 0.2s;
    }
    .card:hover { border-color: rgba(63,182,139,0.4); }
    .card object, .card img { width: 100%; display: block; }
    .card-info {
      padding: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .card-name { font-weight: 700; }
    .card-meta { color: rgba(79,212,164,0.6); font-size: 11px; }
  </style>
</head>
<body>
  <h1>ECNS NFT PREVIEW</h1>
  <p class="subtitle">Phase 3j — Terminal Phosphor Brand Identity • Mordor Testnet (Chain 63)</p>
  <div class="grid">
${gallery.map(g => `    <div class="card">
      <object data="${g.svg}" type="image/svg+xml"></object>
      <div class="card-info">
        <span class="card-name">${g.name}.etc</span>
        <span class="card-meta">${g.tier} • ${g.charClass}</span>
      </div>
    </div>`).join('\n')}
  </div>
</body>
</html>`

  fs.writeFileSync(path.join(svgDir, 'gallery.html'), html)
  console.log(`\nGallery: ${svgDir}/gallery.html (${gallery.length} NFTs)`)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
