import { artifacts, deployScript } from '@rocketh'
import { zeroHash } from 'viem'

export default deployScript(
  async ({
    get,
    deploy,
    namedAccounts: { deployer, owner },
    execute: write,
    read,
    network,
  }) => {
    console.log('Deploying ECNS Registry...')
    await deploy('ENSRegistry', {
      account: deployer,
      artifact: artifacts.ENSRegistry,
    })

    if (!network.tags.use_root) {
      const registry = get<(typeof artifacts.ENSRegistry)['abi']>('ENSRegistry')
      const rootOwner = await read(registry, {
        functionName: 'owner',
        args: [zeroHash],
      })
      if (rootOwner === deployer) {
        console.log('  - Setting final owner of root node on registry')
        await write(registry, {
          functionName: 'setOwner',
          args: [zeroHash, owner],
          account: deployer,
        })
      } else if (rootOwner !== owner) {
        console.warn(
          `  - WARN: Registry is owned by ${rootOwner}; cannot transfer to owner`,
        )
      }
    }
  },
  {
    id: 'ENSRegistry v1.0.0',
    tags: ['category:registry', 'ENSRegistry'],
  },
)
