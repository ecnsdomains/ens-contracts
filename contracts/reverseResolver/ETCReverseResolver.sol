// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import {AbstractReverseResolver} from "./AbstractReverseResolver.sol";
import {ECNS} from "../registry/ECNS.sol";
import {INameResolver} from "../resolvers/profiles/INameResolver.sol";
import {IStandaloneReverseRegistrar} from "../reverseRegistrar/IStandaloneReverseRegistrar.sol";
import {INameReverser} from "./INameReverser.sol";
import {COIN_TYPE_ETH} from "../utils/ECNSIP19.sol";
import {NameCoder} from "../utils/NameCoder.sol";
import {HexUtils} from "../utils/HexUtils.sol";
import {LibABI} from "../utils/LibABI.sol";

/// @title ETC Reverse Resolver
/// @notice Reverses an EVM address using the first non-null response from the following sources:
///
/// 1. `IStandaloneReverseRegistrar` for "addr.reverse"
/// 2. `name()` from "{addr}.addr.reverse" via EIP-181 registry lookup
/// 3. `IStandaloneReverseRegistrar` for "default.reverse"
///
contract ETCReverseResolver is AbstractReverseResolver {
    /// @dev Namehash of "addr.reverse"
    bytes32 constant ADDR_REVERSE_NODE =
        0x91d1777781884d03a6757a803996e38de2a42967fb37eeaca72729271025a9e2;

    /// @notice The ECNS registry contract.
    ECNS immutable ecns;

    /// @notice The reverse registrar contract for "default.reverse".
    IStandaloneReverseRegistrar public immutable defaultRegistrar;

    constructor(
        ECNS _ecns,
        IStandaloneReverseRegistrar addrRegistrar,
        IStandaloneReverseRegistrar _defaultRegistrar
    ) AbstractReverseResolver(COIN_TYPE_ETH, address(addrRegistrar)) {
        ecns = _ecns;
        defaultRegistrar = _defaultRegistrar;
    }

    /// @inheritdoc AbstractReverseResolver
    function _resolveName(
        address addr
    ) internal view override returns (string memory name) {
        name = IStandaloneReverseRegistrar(chainRegistrar).nameForAddr(addr);
        if (bytes(name).length > 0) {
            return name;
        }
        bytes32 node = NameCoder.namehash(
            ADDR_REVERSE_NODE,
            keccak256(bytes(HexUtils.addressToHex(addr)))
        );
        address resolver = ecns.resolver(node);
        if (resolver != address(0)) {
            // note: this only supports onchain direct calls (no extended, no offchain)
            (bool ok, bytes memory v) = resolver.staticcall{gas: 100_000}(
                abi.encodeCall(INameResolver.name, (node))
            );
            if (ok) {
                (ok, v) = LibABI.tryDecodeBytes(v);
            }
            if (!ok) {
                return ""; // terminate on revert or decode failure
            }
            if (v.length > 0) {
                return string(v);
            }
        }
        return defaultRegistrar.nameForAddr(addr);
    }

    /// @inheritdoc INameReverser
    function resolveNames(
        address[] memory addrs
    ) external view returns (string[] memory names) {
        names = new string[](addrs.length);
        for (uint256 i; i < addrs.length; ++i) {
            names[i] = _resolveName(addrs[i]);
        }
    }
}
