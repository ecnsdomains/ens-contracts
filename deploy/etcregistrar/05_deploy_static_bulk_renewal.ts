import { artifacts, deployScript } from '@rocketh'
import { namehash, zeroAddress } from 'viem'
import { createInterfaceId } from '../../test/fixtures/createInterfaceId.js'

export default deployScript(
  async ({ deploy, execute: write, get, read, namedAccounts, network }) => {
    const { deployer, owner } = namedAccounts

    const registry = get<(typeof artifacts.ENSRegistry)['abi']>('ENSRegistry')
    const controller = get<(typeof artifacts.ETCRegistrarController)['abi']>(
      'ETCRegistrarController',
    )

    const bulkRenewal = await deploy('StaticBulkRenewal', {
      account: deployer,
      artifact: artifacts.StaticBulkRenewal,
      args: [controller.address],
    })

    // Only attempt to make resolver etc changes directly on testnets
    if (network.name === 'mainnet' && !network.tags.tenderly) return

    const interfaceId = createInterfaceId(bulkRenewal.abi)
    const resolver = await read(registry, {
      functionName: 'resolver',
      args: [namehash('etc')],
    })
    if (resolver === zeroAddress) {
      console.warn(
        `  - WARN: No resolver set for .etc; not setting interface ${interfaceId} for BulkRenewal`,
      )
      return
    }

    console.log(
      `  - Setting BulkRenewal interface ID ${interfaceId} on .etc resolver`,
    )
    await write(
      { ...artifacts.OwnedResolver, address: resolver },
      {
        functionName: 'setInterface',
        args: [namehash('etc'), interfaceId, bulkRenewal.address],
        account: owner,
      },
    )
  },
  {
    id: 'StaticBulkRenewal v1.0.0',
    tags: ['category:etcregistrar', 'StaticBulkRenewal'],
    dependencies: ['ETCRegistrarController'],
  },
)
