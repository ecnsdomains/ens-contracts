import { artifacts, deployScript } from '@rocketh'
import { getAddress, type Address } from 'viem'

import { TLD, RESOLVER_NODE } from '../config'

export default deployScript(
  async ({ deploy, get, execute: write, read, namedAccounts, network }) => {
    const { deployer, owner } = namedAccounts

    // Get dependencies
    const registry = get<(typeof artifacts.ENSRegistry)['abi']>('ENSRegistry')
    const nameWrapper =
      get<(typeof artifacts.NameWrapper)['abi']>('NameWrapper')
    const controller = get<(typeof artifacts.ETCRegistrarController)['abi']>(
      'ETCRegistrarController',
    )
    const reverseRegistrar =
      get<(typeof artifacts.ReverseRegistrar)['abi']>('ReverseRegistrar')

    // Deploy PublicResolver
    const publicResolver = await deploy('PublicResolver', {
      account: deployer,
      artifact: artifacts.PublicResolver,
      args: [
        registry.address,
        nameWrapper.address,
        controller.address,
        reverseRegistrar.address,
      ],
    })

    if (!publicResolver.newlyDeployed) return

    // Only attempt to make controller etc changes directly on testnets
    if (network.name === 'mainnet' && !network.tags?.tenderly) return

    // Check if PublicResolver is already the default resolver on ReverseRegistrar
    const isReverseRegistrarDefaultResolver = await read(reverseRegistrar, {
      functionName: 'defaultResolver',
      args: [],
    }).then(
      (v) => getAddress(v as Address) === getAddress(publicResolver.address),
    )
    if (!isReverseRegistrarDefaultResolver) {
      console.log(
        `  - Setting PublicResolver as default resolver on ReverseRegistrar`,
      )
      await write(reverseRegistrar, {
        functionName: 'setDefaultResolver',
        args: [publicResolver.address],
        account: owner,
      })
    }

    const resolverNodeOwner = await read(registry, {
      functionName: 'owner',
      args: [RESOLVER_NODE],
    })

    if (resolverNodeOwner === owner) {
      console.log(`  - Setting resolver for resolver.${TLD} to PublicResolver`)
      await write(registry, {
        functionName: 'setResolver',
        args: [RESOLVER_NODE, publicResolver.address],
        account: owner,
      })

      console.log(`  - Setting addr for resolver.${TLD} to PublicResolver`)
      await write(publicResolver, {
        functionName: 'setAddr',
        args: [RESOLVER_NODE, publicResolver.address],
        account: owner,
      })
    } else {
      console.warn(
        `  - WARN: resolver.${TLD} is not owned by the owner address, not setting resolver`,
      )
    }
  },
  {
    id: 'PublicResolver v3.0.0',
    tags: ['category:resolvers', 'PublicResolver'],
    dependencies: [
      'ENSRegistry',
      'NameWrapper',
      'ETCRegistrarController',
      'ReverseRegistrar',
    ],
  },
)
