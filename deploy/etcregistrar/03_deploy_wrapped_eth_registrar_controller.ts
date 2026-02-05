import { artifacts, deployScript } from '@rocketh'
import type { Artifact } from 'rocketh'
import { namehash, zeroAddress, type Abi } from 'viem'
import wrappedEthRegistrarArtifactRaw from '../../deployments/mainnet/WrappedETCRegistrarController.json'

const wrappedEthRegistrarArtifact =
  wrappedEthRegistrarArtifactRaw as unknown as Artifact<Abi>

export default deployScript(
  async ({
    deploy,
    get,
    execute: write,
    read,
    namedAccounts,
    network,
    registerWrappedNames,
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
    const nameWrapper =
      get<(typeof artifacts.NameWrapper)['abi']>('NameWrapper')

    const controller = await deploy('WrappedETCRegistrarController', {
      account: deployer,
      artifact: wrappedEthRegistrarArtifact,
      args: [
        registrar.address,
        priceOracle.address,
        60n,
        86400n,
        reverseRegistrar.address,
        nameWrapper.address,
        registry.address,
      ],
    })

    if (!controller.newlyDeployed) return

    // Transfer ownership to owner
    if (owner !== deployer) {
      console.log(
        `  - Transferring ownership of WrappedETCRegistrarController to ${owner}`,
      )
      await write(controller, {
        functionName: 'transferOwnership',
        args: [owner],
        account: deployer,
      })
    }

    // Only attempt to make controller etc changes directly on testnets
    if (network.name === 'mainnet' && !network.tags?.tenderly) return

    console.log(
      '  - Adding WrappedETCRegistrarController as controller on NameWrapper',
    )
    await write(nameWrapper, {
      functionName: 'setController',
      args: [controller.address, true],
      account: owner,
    })

    // Add controller to BaseRegistrarImplementation
    console.log(
      `  - Adding WrappedETCRegistrarController via RegistrarSecurityController`,
    )
    await write(registrarSecurityController, {
      functionName: 'addRegistrarController',
      args: [controller.address],
      account: owner,
    })

    // Add controller to ReverseRegistrar
    console.log(
      `  - Adding WrappedETCRegistrarController as controller on ReverseRegistrar`,
    )
    await write(reverseRegistrar, {
      functionName: 'setController',
      args: [controller.address, true],
      account: owner,
    })

    // Set interface on resolver
    const interfaceId = '0x612e8c09'

    const resolver = await read(registry, {
      functionName: 'resolver',
      args: [namehash('etc')],
    })
    if (resolver === zeroAddress) {
      console.warn(
        `  - WARN: No resolver set for .etc; not setting interface ${interfaceId} for WrappedETCRegistrarController`,
      )
      return
    }

    console.log(
      `  - Setting WrappedETCRegistrarController interface ID ${interfaceId} on .etc resolver`,
    )
    await write(
      { ...artifacts.OwnedResolver, address: resolver },
      {
        functionName: 'setInterface',
        args: [namehash('etc'), interfaceId, controller.address],
        account: owner,
      },
    )

    if (registerWrappedNames) {
      console.log('  - Running registerWrappedNames hook')
      await registerWrappedNames()
    }
  },
  {
    id: 'ETCRegistrarController v2.0.0',
    tags: ['category:etcregistrar', 'WrappedETCRegistrarController'],
    dependencies: [
      'ENSRegistry',
      'BaseRegistrarImplementation',
      'RegistrarSecurityController',
      'ExponentialPremiumPriceOracle',
      'ReverseRegistrar',
      'NameWrapper',
      'OwnedResolver',
    ],
  },
)
