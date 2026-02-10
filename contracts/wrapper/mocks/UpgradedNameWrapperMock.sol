//SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;
import {INameWrapperUpgrade} from "../INameWrapperUpgrade.sol";
import "../../registry/ECNS.sol";
import "../../etcregistrar/IBaseRegistrar.sol";
import {NameCoder} from "../../utils/NameCoder.sol";

contract UpgradedNameWrapperMock is INameWrapperUpgrade {
    bytes32 private constant ETC_NODE =
        0x2f142013fcc88d47bffe42e5d883f6081cbaa75abaa20e7f34f3043bbc8162c9;

    ECNS public immutable ecns;
    IBaseRegistrar public immutable registrar;

    constructor(ECNS _ecns, IBaseRegistrar _registrar) {
        ecns = _ecns;
        registrar = _registrar;
    }

    event NameUpgraded(
        bytes name,
        address wrappedOwner,
        uint32 fuses,
        uint64 expiry,
        address approved,
        bytes extraData
    );

    function wrapFromUpgrade(
        bytes calldata name,
        address wrappedOwner,
        uint32 fuses,
        uint64 expiry,
        address approved,
        bytes calldata extraData
    ) public {
        (bytes32 labelhash, uint256 offset) = NameCoder.readLabel(name, 0);
        bytes32 parentNode = NameCoder.namehash(name, offset);
        bytes32 node = _makeNode(parentNode, labelhash);

        if (parentNode == ETC_NODE) {
            address registrant = registrar.ownerOf(uint256(labelhash));
            require(
                msg.sender == registrant &&
                    registrar.isApprovedForAll(registrant, address(this)),
                "No approval for registrar"
            );
        } else {
            address owner = ecns.owner(node);
            require(
                msg.sender == owner &&
                    ecns.isApprovedForAll(owner, address(this)),
                "No approval for registry"
            );
        }
        emit NameUpgraded(
            name,
            wrappedOwner,
            fuses,
            expiry,
            approved,
            extraData
        );
    }

    function _makeNode(
        bytes32 node,
        bytes32 labelhash
    ) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(node, labelhash));
    }
}
