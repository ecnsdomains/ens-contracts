import { createWalletClient, createPublicClient, http } from 'viem'
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
  rpcUrls: { default: { http: ['https://rpc.mordor.etccooperative.org'] } },
  testnet: true,
} as const

// ETCswap addresses on Mordor
const WETC = '0x1953cab0E5bFa6D4a9BaD6E05fD46C1CC6527a5a' as const
const USC = '0xDE093684c796204224BC081f937aa059D903c52a' as const

// V2
const V2_PAIR = '0x0a73dc518791Fa8436939C8a8a08003EC782A509' as const

// V3 - need to find the WETC/USC pool
const V3_FACTORY = '0x2624E907BcC04f93C8f29d7C7149a8700Ceb8cDC' as const

const pairAbi = [
  {
    inputs: [],
    name: 'token0',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'getReserves',
    outputs: [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
] as const

const v3FactoryAbi = [
  {
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' }
    ],
    name: 'getPool',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const

const v3PoolAbi = [
  {
    inputs: [],
    name: 'token0',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'slot0',
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'liquidity',
    outputs: [{ type: 'uint128' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const

async function main() {
  const privateKey = process.env.DEPLOYER_KEY
  if (!privateKey) throw new Error('DEPLOYER_KEY not set')

  const account = privateKeyToAccount(`0x${privateKey}`)
  console.log('Deploying from:', account.address)

  const publicClient = createPublicClient({ chain: mordor, transport: http() })
  const walletClient = createWalletClient({ account, chain: mordor, transport: http() })

  // ============ V2 Pool Check ============
  console.log('\n=== ETCswap V2 Pool ===')
  const v2Token0 = await publicClient.readContract({
    address: V2_PAIR,
    abi: pairAbi,
    functionName: 'token0'
  })
  const v2Token1 = await publicClient.readContract({
    address: V2_PAIR,
    abi: pairAbi,
    functionName: 'token1'
  })
  console.log('V2 Pair:', V2_PAIR)
  console.log('  Token0:', v2Token0)
  console.log('  Token1:', v2Token1)

  const v2WetcIsToken0 = v2Token0.toLowerCase() === WETC.toLowerCase()
  console.log('  WETC is token0:', v2WetcIsToken0)

  const v2Reserves = await publicClient.readContract({
    address: V2_PAIR,
    abi: pairAbi,
    functionName: 'getReserves'
  })
  const v2WetcReserve = v2WetcIsToken0 ? v2Reserves[0] : v2Reserves[1]
  const v2UscReserve = v2WetcIsToken0 ? v2Reserves[1] : v2Reserves[0]
  console.log('  WETC Reserve:', Number(v2WetcReserve) / 1e18)
  console.log('  USC Reserve:', Number(v2UscReserve) / 1e6)

  if (v2WetcReserve > 0n) {
    const v2Price = (v2UscReserve * BigInt(10**20)) / v2WetcReserve
    console.log('  V2 Price (8 dec):', v2Price.toString())
    console.log('  V2 Price (USD):', Number(v2Price) / 1e8)
  }

  // ============ V3 Pool Check ============
  console.log('\n=== ETCswap V3 Pool ===')

  // Check common fee tiers: 0.05%, 0.3%, 1%
  const feeTiers = [500, 3000, 10000]
  let v3Pool: `0x${string}` | null = null
  let v3FeeTier = 0

  for (const fee of feeTiers) {
    const poolAddr = await publicClient.readContract({
      address: V3_FACTORY,
      abi: v3FactoryAbi,
      functionName: 'getPool',
      args: [WETC, USC, fee]
    })
    if (poolAddr !== '0x0000000000000000000000000000000000000000') {
      console.log(`Found V3 pool at fee tier ${fee/10000}%:`, poolAddr)
      v3Pool = poolAddr as `0x${string}`
      v3FeeTier = fee
      break
    }
  }

  let v3WetcIsToken0 = false

  if (v3Pool) {
    const v3Token0 = await publicClient.readContract({
      address: v3Pool,
      abi: v3PoolAbi,
      functionName: 'token0'
    })
    v3WetcIsToken0 = v3Token0.toLowerCase() === WETC.toLowerCase()
    console.log('  WETC is token0:', v3WetcIsToken0)

    const slot0 = await publicClient.readContract({
      address: v3Pool,
      abi: v3PoolAbi,
      functionName: 'slot0'
    })
    console.log('  sqrtPriceX96:', slot0[0].toString())
    console.log('  tick:', slot0[1])

    const liquidity = await publicClient.readContract({
      address: v3Pool,
      abi: v3PoolAbi,
      functionName: 'liquidity'
    })
    console.log('  liquidity:', liquidity.toString())

    // Calculate V3 price from sqrtPriceX96
    const sqrtPrice = slot0[0]
    let v3Price: bigint
    if (v3WetcIsToken0) {
      // price = sqrtPrice^2 / 2^192 * 10^20
      v3Price = (sqrtPrice * sqrtPrice * BigInt(10**20)) >> BigInt(192)
    } else {
      // Inverted
      v3Price = (BigInt(1) << BigInt(192)) * BigInt(10**20) / (sqrtPrice * sqrtPrice)
    }
    console.log('  V3 Price (8 dec):', v3Price.toString())
    console.log('  V3 Price (USD):', Number(v3Price) / 1e8)
  } else {
    console.log('No V3 pool found for WETC/USC')
  }

  // ============ Compile & Deploy ============
  console.log('\n=== Compiling Contracts ===')
  const { execSync } = await import('child_process')
  execSync('pnpm compile', { cwd: path.join(__dirname, '..'), stdio: 'inherit' })

  console.log('\n=== Deploying ETCswapFullOracle ===')
  const artifactsDir = path.join(__dirname, '../artifacts/contracts')
  const oracleArtifact = JSON.parse(
    fs.readFileSync(
      path.join(artifactsDir, 'etcregistrar/ETCswapFullOracle.sol', 'ETCswapFullOracle.json'),
      'utf8'
    )
  )

  // Use V2 pair if no V3 pool, or zero address for V3 if not available
  const v3PoolAddress = v3Pool || '0x0000000000000000000000000000000000000000'

  const oracleHash = await walletClient.deployContract({
    abi: oracleArtifact.abi,
    bytecode: oracleArtifact.bytecode as `0x${string}`,
    args: [V2_PAIR, v2WetcIsToken0, v3PoolAddress, v3WetcIsToken0],
  })
  console.log('Transaction:', oracleHash)
  const oracleReceipt = await publicClient.waitForTransactionReceipt({ hash: oracleHash })
  const oracleAddress = oracleReceipt.contractAddress!
  console.log('ETCswapFullOracle deployed at:', oracleAddress)

  // ============ Test Oracle ============
  console.log('\n=== Testing Oracle ===')
  const oracleAbi = [
    {
      inputs: [],
      name: 'latestAnswer',
      outputs: [{ type: 'int256' }],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [],
      name: 'getPrices',
      outputs: [
        { name: 'v2Price', type: 'int256' },
        { name: 'v3Price', type: 'int256' }
      ],
      stateMutability: 'view',
      type: 'function'
    }
  ] as const

  try {
    const prices = await publicClient.readContract({
      address: oracleAddress as `0x${string}`,
      abi: oracleAbi,
      functionName: 'getPrices'
    })
    console.log('V2 Price:', Number(prices[0]) / 1e8, 'USD')
    console.log('V3 Price:', Number(prices[1]) / 1e8, 'USD')

    const finalPrice = await publicClient.readContract({
      address: oracleAddress as `0x${string}`,
      abi: oracleAbi,
      functionName: 'latestAnswer'
    })
    console.log('Final Price:', Number(finalPrice) / 1e8, 'USD')
  } catch (e: any) {
    console.log('Oracle test failed:', e.message?.slice(0, 200))
  }

  // ============ Update Deployments ============
  const deploymentsPath = path.join(__dirname, '../deployments/mordor.json')
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'))
  deployments.contracts.ETCswapFullOracle = oracleAddress
  deployments.oracle = {
    type: 'ETCswapFull',
    description: 'Aggregates prices from V2, V3, and V4 (when enabled)',
    v2: {
      pair: V2_PAIR,
      wetcIsToken0: v2WetcIsToken0
    },
    v3: {
      pool: v3PoolAddress,
      wetcIsToken0: v3WetcIsToken0,
      feeTier: v3FeeTier
    },
    v4: {
      enabled: false,
      note: 'Configure after Olympia upgrade via configureV4()'
    }
  }
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2))

  console.log('\n=== Deployment Complete ===')
  console.log('ETCswapFullOracle:', oracleAddress)
  console.log('\nFeatures:')
  console.log('  - V2: Enabled (spot price from reserves)')
  console.log('  - V3: Enabled (sqrtPriceX96 from slot0)')
  console.log('  - V4: Ready (call configureV4() after Olympia)')
  console.log('\nTo use this oracle, redeploy StablePriceOracle with this address.')
}

main().catch(console.error)
