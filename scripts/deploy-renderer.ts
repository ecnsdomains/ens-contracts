/**
 * Deploy updated BaseRegistrar with ECNSMetadataRenderer support.
 *
 * Cascade: Renderer -> BaseRegistrar -> Controller -> PublicResolver -> config
 *
 * The on-chain BaseRegistrar lacks metadataRenderer/setMetadataRenderer (old 2-arg constructor).
 * Must redeploy: BaseRegistrar, Controller (immutable base ref), PublicResolver (immutable controller ref).
 *
 * Uses local Mordor RPC at http://localhost:8545
 */
import { createWalletClient, createPublicClient, http, keccak256, toHex, labelhash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const mordor = {
  id: 63,
  name: 'Mordor',
  nativeCurrency: { name: 'Mordor Ether', symbol: 'METC', decimals: 18 },
  rpcUrls: { default: { http: ['http://localhost:8545'] } },
  testnet: true,
} as const

const CONTRACTS_DIR = '/media/dev/2tb/dev/ecns/contracts'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`
const ROOT_NODE = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`

async function main() {
  const privateKey = process.env.DEPLOYER_KEY
  if (!privateKey) throw new Error('DEPLOYER_KEY not set')

  const account = privateKeyToAccount(`0x${privateKey}`)
  const publicClient = createPublicClient({ chain: mordor, transport: http() })
  const walletClient = createWalletClient({ account, chain: mordor, transport: http() })

  const balance = await publicClient.getBalance({ address: account.address })
  console.log('Deployer:', account.address)
  console.log('Balance:', Number(balance) / 1e18, 'METC')

  // Load artifacts
  const artifactsDir = path.join(CONTRACTS_DIR, 'artifacts/contracts')
  const loadArtifact = (p: string, n: string) =>
    JSON.parse(fs.readFileSync(path.join(artifactsDir, p, `${n}.json`), 'utf8'))

  // Load deployments
  const deploymentsPath = path.join(CONTRACTS_DIR, 'deployments/mordor.json')
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'))

  // Contracts we keep
  const ECNSRegistry = deployments.contracts.ECNSRegistry as `0x${string}`
  const ReverseRegistrar = deployments.contracts.ReverseRegistrar as `0x${string}`
  const DefaultReverseRegistrar = deployments.contracts.DefaultReverseRegistrar as `0x${string}`
  const ECNSWordDictionary = deployments.contracts.ECNSWordDictionary as `0x${string}`
  const etcNode = deployments.tld.node as `0x${string}`
  const etcLabelHash = deployments.tld.labelHash as `0x${string}`

  // Get price oracle from existing controller
  const oldController = deployments.contracts.ETCRegistrarController as `0x${string}`
  const controllerArtifact = loadArtifact('etcregistrar/ETCRegistrarController.sol', 'ETCRegistrarController')
  const priceOracle = await publicClient.readContract({
    address: oldController,
    abi: controllerArtifact.abi,
    functionName: 'prices',
  }) as `0x${string}`

  console.log('\nKept: ECNSRegistry:', ECNSRegistry)
  console.log('Kept: ReverseRegistrar:', ReverseRegistrar)
  console.log('Kept: ECNSWordDictionary:', ECNSWordDictionary)
  console.log('Kept: PriceOracle:', priceOracle)

  const rendererArtifact = loadArtifact('nft/ECNSMetadataRenderer.sol', 'ECNSMetadataRenderer')
  const baseArtifact = loadArtifact('etcregistrar/BaseRegistrarImplementation.sol', 'BaseRegistrarImplementation')
  const resolverArtifact = loadArtifact('resolvers/PublicResolver.sol', 'PublicResolver')
  const registryAbi = loadArtifact('registry/ECNSRegistry.sol', 'ECNSRegistry').abi
  const reverseAbi = loadArtifact('reverseRegistrar/ReverseRegistrar.sol', 'ReverseRegistrar').abi

  // Save old addresses for report
  const oldAddresses = { ...deployments.contracts }

  // ===================== DEPLOY =====================

  // 1. ECNSMetadataRenderer
  console.log('\n[1/4] Deploying ECNSMetadataRenderer...')
  const r1 = await publicClient.waitForTransactionReceipt({
    hash: await walletClient.deployContract({
      abi: rendererArtifact.abi,
      bytecode: rendererArtifact.bytecode as `0x${string}`,
      args: [ECNSWordDictionary],
    }),
  })
  const newRenderer = r1.contractAddress!
  console.log('  Address:', newRenderer, `(gas: ${r1.gasUsed})`)

  // 2. BaseRegistrar
  console.log('\n[2/4] Deploying BaseRegistrar...')
  const r2 = await publicClient.waitForTransactionReceipt({
    hash: await walletClient.deployContract({
      abi: baseArtifact.abi,
      bytecode: baseArtifact.bytecode as `0x${string}`,
      args: [ECNSRegistry, etcNode, newRenderer],
    }),
  })
  const newBase = r2.contractAddress!
  console.log('  Address:', newBase, `(gas: ${r2.gasUsed})`)

  // 3. ETCRegistrarController
  console.log('\n[3/4] Deploying ETCRegistrarController...')
  const r3 = await publicClient.waitForTransactionReceipt({
    hash: await walletClient.deployContract({
      abi: controllerArtifact.abi,
      bytecode: controllerArtifact.bytecode as `0x${string}`,
      args: [newBase, priceOracle, 60, 86400, ReverseRegistrar, DefaultReverseRegistrar, ECNSRegistry],
    }),
  })
  const newController = r3.contractAddress!
  console.log('  Address:', newController, `(gas: ${r3.gasUsed})`)

  // 4. PublicResolver
  console.log('\n[4/4] Deploying PublicResolver...')
  const r4 = await publicClient.waitForTransactionReceipt({
    hash: await walletClient.deployContract({
      abi: resolverArtifact.abi,
      bytecode: resolverArtifact.bytecode as `0x${string}`,
      args: [ECNSRegistry, ZERO_ADDRESS, newController, ReverseRegistrar],
    }),
  })
  const newResolver = r4.contractAddress!
  console.log('  Address:', newResolver, `(gas: ${r4.gasUsed})`)

  // ===================== CONFIGURE =====================
  console.log('\n--- Configuring ---')

  // Reassign .etc TLD
  console.log('  Setting .etc owner to new BaseRegistrar...')
  await publicClient.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: ECNSRegistry, abi: registryAbi,
      functionName: 'setSubnodeOwner',
      args: [ROOT_NODE, etcLabelHash, newBase],
    }),
  })

  // Add controller
  console.log('  Adding controller to BaseRegistrar...')
  await publicClient.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: newBase, abi: baseArtifact.abi,
      functionName: 'addController', args: [newController],
    }),
  })

  // Set default resolver on ReverseRegistrar
  console.log('  Setting default resolver...')
  await publicClient.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: ReverseRegistrar, abi: reverseAbi,
      functionName: 'setDefaultResolver', args: [newResolver],
    }),
  })

  // ===================== RESERVE NAMES =====================
  console.log('\n--- Reserving offensive names ---')
  const reservedPath = path.join(CONTRACTS_DIR, 'config/reserved-names.json')
  if (fs.existsSync(reservedPath)) {
    const config = JSON.parse(fs.readFileSync(reservedPath, 'utf8'))
    const allNames: string[] = []
    for (const cat of Object.values(config.categories) as any[]) {
      allNames.push(...cat.names)
    }
    console.log(`  Total: ${allNames.length} names`)

    const BATCH = 200
    for (let i = 0; i < allNames.length; i += BATCH) {
      const batch = allNames.slice(i, i + BATCH)
      try {
        await publicClient.waitForTransactionReceipt({
          hash: await walletClient.writeContract({
            address: newController, abi: controllerArtifact.abi,
            functionName: 'reserveNames', args: [batch],
          }),
        })
        console.log(`  Batch ${Math.floor(i/BATCH)+1}/${Math.ceil(allNames.length/BATCH)} done`)
      } catch (e: any) {
        console.log(`  Batch ${Math.floor(i/BATCH)+1} failed: ${e.message?.slice(0, 100)}`)
      }
    }
  }

  // ===================== UPDATE MORDOR.JSON =====================
  console.log('\n--- Updating mordor.json ---')
  deployments.contracts.BaseRegistrar = newBase
  deployments.contracts.ECNSMetadataRenderer = newRenderer
  deployments.contracts.ETCRegistrarController = newController
  deployments.contracts.PublicResolver = newResolver
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2))
  console.log('  Done!')

  // ===================== TEST REGISTRATION + TOKEN URI =====================
  console.log('\n--- Registering test name ---')
  const testName = 'holographic'
  const duration = BigInt(365 * 24 * 60 * 60)
  const secret = keccak256(toHex(`renderer-${Date.now()}`))
  const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`

  const reg = {
    label: testName,
    owner: account.address,
    duration,
    secret,
    resolver: newResolver,
    data: [] as `0x${string}`[],
    reverseRecord: 0,
    referrer: ZERO_BYTES32,
  }

  const price = await publicClient.readContract({
    address: newController, abi: controllerArtifact.abi,
    functionName: 'rentPrice', args: [testName, duration],
  }) as { base: bigint; premium: bigint }
  const total = price.base + price.premium
  console.log(`  "${testName}.etc" costs ${Number(total) / 1e18} METC`)

  // Commit
  const commitment = await publicClient.readContract({
    address: newController, abi: controllerArtifact.abi,
    functionName: 'makeCommitment', args: [reg],
  }) as `0x${string}`
  await publicClient.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: newController, abi: controllerArtifact.abi,
      functionName: 'commit', args: [commitment],
    }),
  })
  console.log('  Committed. Waiting 70s for minCommitmentAge...')
  await new Promise(r => setTimeout(r, 70000))

  // Register
  const regReceipt = await publicClient.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: newController, abi: controllerArtifact.abi,
      functionName: 'register', args: [reg],
      value: total + total / 10n,
    }),
  })
  console.log(`  Registered! Gas: ${regReceipt.gasUsed}`)

  // Test tokenURI
  const tokenId = BigInt(labelhash(testName))
  try {
    const uri = await publicClient.readContract({
      address: newBase, abi: baseArtifact.abi,
      functionName: 'tokenURI', args: [tokenId],
    }) as string

    const jsonB64 = uri.replace('data:application/json;base64,', '')
    const meta = JSON.parse(Buffer.from(jsonB64, 'base64').toString())

    console.log('\n  === TOKEN URI ===')
    console.log('  Name:', meta.name)
    for (const a of meta.attributes) {
      const val = a.display_type === 'date'
        ? new Date(a.value * 1000).toISOString()
        : a.value
      console.log(`  ${a.trait_type}: ${val}`)
    }

    if (meta.image?.startsWith('data:image/svg+xml;base64,')) {
      const svg = Buffer.from(
        meta.image.replace('data:image/svg+xml;base64,', ''), 'base64'
      ).toString()
      console.log(`  SVG: ${svg.length} chars`)
      const svgDir = path.join(CONTRACTS_DIR, 'svg-prototype')
      if (!fs.existsSync(svgDir)) fs.mkdirSync(svgDir, { recursive: true })
      fs.writeFileSync(path.join(svgDir, `test-output-${testName}.svg`), svg)
    }
    console.log('\n  tokenURI: WORKING')
  } catch (e: any) {
    console.log('  tokenURI ERROR:', e.message?.slice(0, 300))
  }

  // ===================== SUMMARY =====================
  console.log('\n' + '='.repeat(60))
  console.log('DEPLOYMENT COMPLETE - Mordor (Chain 63)')
  console.log('='.repeat(60))
  console.log('NEW CONTRACTS:')
  console.log('  ECNSMetadataRenderer:', newRenderer)
  console.log('  BaseRegistrar:       ', newBase)
  console.log('  ETCRegistrarController:', newController)
  console.log('  PublicResolver:      ', newResolver)
  console.log('\nKEPT CONTRACTS:')
  console.log('  ECNSRegistry:        ', ECNSRegistry)
  console.log('  ReverseRegistrar:    ', ReverseRegistrar)
  console.log('  DefaultReverseRegistrar:', DefaultReverseRegistrar)
  console.log('  ECNSWordDictionary:  ', ECNSWordDictionary)
  console.log('  PriceOracle:         ', priceOracle)
  console.log('\nOLD (deprecated):')
  console.log('  BaseRegistrar:       ', oldAddresses.BaseRegistrar)
  console.log('  ETCRegistrarController:', oldAddresses.ETCRegistrarController)
  console.log('  PublicResolver:      ', oldAddresses.PublicResolver)
  console.log('  ECNSMetadataRenderer:', oldAddresses.ECNSMetadataRenderer)
  console.log('='.repeat(60))
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
