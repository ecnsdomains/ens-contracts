import { type artifacts, deployScript } from '@rocketh'

import { TLD, TLD_LABEL_HASH } from '../config'

export default deployScript(
  async ({
    get,
    execute: write,
    namedAccounts: { deployer, owner },
    network,
  }) => {
    if (!network.tags.use_root) return

    const root = get<(typeof artifacts.Root)['abi']>('Root')
    const registrar = get<
      (typeof artifacts.BaseRegistrarImplementation)['abi']
    >('BaseRegistrarImplementation')
    const registrarSecurityController = get<
      (typeof artifacts.RegistrarSecurityController)['abi']
    >('RegistrarSecurityController')

    // 1. Transfer ownership of registrar to RegistrarSecurityController
    console.log(
      `  - Transferring ownership of registrar to RegistrarSecurityController`,
    )
    await write(registrar, {
      functionName: 'transferOwnership',
      args: [registrarSecurityController.address],
      account: deployer,
    })

    // 2. Set owner of TLD node to registrar on root
    console.log(`  - Setting owner of .${TLD} node to registrar on root`)
    await write(root, {
      functionName: 'setSubnodeOwner',
      args: [TLD_LABEL_HASH, registrar.address],
      account: owner,
    })
  },
  {
    id: 'BaseRegistrarImplementation:setup v1.0.0',
    tags: [
      'category:etcregistrar',
      'BaseRegistrarImplementation',
      'BaseRegistrarImplementation:setup',
    ],
    // Runs after the root is setup
    dependencies: [
      'Root',
      'BaseRegistrarImplementation:contract',
      'RegistrarSecurityController:contract',
    ],
  },
)
