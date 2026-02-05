import { artifacts, deployScript } from '@rocketh'
import { namehash, zeroAddress } from 'viem'
import { createInterfaceId } from '../../test/fixtures/createInterfaceId.js'

export default deployScript(
  async ({
    deploy,
    get,
    execute: write,
    read,
    namedAccounts,
    network,
    registerUnwrappedNames,
  }) => {
    const { deployer, owner } = namedAccounts

    const registry = get<(typeof artifacts.ENSRegistry)['abi']>('ENSRegistry')
    const registrar = get<
      (typeof artifacts.BaseRegistrarImplementation)['abi']
    >('BaseRegistrarImplementation')
    const registrarSecurityController = get<
      (typeof artifacts.RegistrarSecurityController)['abi']
    >('RegistrarSecurityController')
    const priceOracle = get<
      (typeof artifacts.ExponentialPremiumPriceOracle)['abi']
    >('ExponentialPremiumPriceOracle')
    const reverseRegistrar =
      get<(typeof artifacts.ReverseRegistrar)['abi']>('ReverseRegistrar')
    const defaultReverseRegistrar = get<
      (typeof artifacts.DefaultReverseRegistrar)['abi']
    >('DefaultReverseRegistrar')

    const controller = await deploy('ETCRegistrarController', {
      account: deployer,
      artifact: artifacts.ETCRegistrarController,
      args: [
        registrar.address,
        priceOracle.address,
        60n,
        86400n,
        reverseRegistrar.address,
        defaultReverseRegistrar.address,
        registry.address,
      ],
    })

    if (!controller.newlyDeployed) return

    // Transfer ownership to owner
    if (owner !== deployer) {
      console.log(
        `  - Transferring ownership of ETCRegistrarController to ${owner}`,
      )
      await write(controller, {
        functionName: 'transferOwnership',
        args: [owner],
        account: deployer,
      })
    }

    // Only attempt to make controller etc changes directly on testnets
    if (network.name === 'mainnet' && !network.tags?.tenderly) return

    // Add controller to BaseRegistrarImplementation
    console.log(
      `  - Adding ETCRegistrarController via RegistrarSecurityController`,
    )
    await write(registrarSecurityController, {
      functionName: 'addRegistrarController',
      args: [controller.address],
      account: owner,
    })

    // Add controller to ReverseRegistrar
    console.log(
      `  - Adding ETCRegistrarController as controller on ReverseRegistrar`,
    )
    await write(reverseRegistrar, {
      functionName: 'setController',
      args: [controller.address, true],
      account: owner,
    })

    // Add controller to DefaultReverseRegistrar
    console.log(
      `  - Adding ETCRegistrarController as controller on DefaultReverseRegistrar`,
    )
    await write(defaultReverseRegistrar, {
      functionName: 'setController',
      args: [controller.address, true],
      account: owner,
    })

    // Set interface on resolver
    const artifact = artifacts.IETCRegistrarController
    const interfaceId = createInterfaceId(artifact.abi)

    const resolver = await read(registry, {
      functionName: 'resolver',
      args: [namehash('etc')],
    })
    if (resolver === zeroAddress) {
      console.warn(
        `  - WARN: No resolver set for .etc; not setting interface ${interfaceId} for ETCRegistrarController`,
      )
      return
    }

    console.log(
      `  - Setting ETCRegistrarController interface ID ${interfaceId} on .etc resolver`,
    )
    await write(
      { ...artifacts.OwnedResolver, address: resolver },
      {
        functionName: 'setInterface',
        args: [namehash('etc'), interfaceId, controller.address],
        account: owner,
      },
    )

    if (registerUnwrappedNames) {
      console.log('  - Running registerUnwrappedNames hook')
      await registerUnwrappedNames()
    }
  },
  {
    id: 'ETCRegistrarController v3.0.0',
    tags: ['category:etcregistrar', 'ETCRegistrarController'],
    dependencies: [
      'ENSRegistry',
      'BaseRegistrarImplementation',
      'RegistrarSecurityController',
      'ExponentialPremiumPriceOracle',
      'ReverseRegistrar',
      'DefaultReverseRegistrar',
      'NameWrapper',
      'OwnedResolver',
    ],
  },
)
