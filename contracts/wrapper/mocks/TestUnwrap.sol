//SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;
import "../../registry/ECNS.sol";
import "../../etcregistrar/IBaseRegistrar.sol";
import {NameCoder} from "../../utils/NameCoder.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract TestUnwrap is Ownable {
    bytes32 private constant ETC_NODE =
        0x2f142013fcc88d47bffe42e5d883f6081cbaa75abaa20e7f34f3043bbc8162c9;

    ECNS public immutable ecns;
    IBaseRegistrar public immutable registrar;
    mapping(address => bool) public approvedWrapper;

    constructor(ECNS _ecns, IBaseRegistrar _registrar) {
        ecns = _ecns;
        registrar = _registrar;
    }

    function setWrapperApproval(
        address wrapper,
        bool approved
    ) public onlyOwner {
        approvedWrapper[wrapper] = approved;
    }

    function wrapETH2LD(
        string calldata label,
        address wrappedOwner,
        uint32 fuses,
        uint64 expiry,
        address resolver
    ) public {
        _unwrapETH2LD(keccak256(bytes(label)), wrappedOwner, msg.sender);
    }

    function setSubnodeRecord(
        bytes32 parentNode,
        string memory label,
        address newOwner,
        address resolver,
        uint64 ttl,
        uint32 fuses,
        uint64 expiry
    ) public {
        bytes32 node = _makeNode(parentNode, keccak256(bytes(label)));
        _unwrapSubnode(node, newOwner, msg.sender);
    }

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
            _unwrapETH2LD(labelhash, wrappedOwner, msg.sender);
        } else {
            _unwrapSubnode(node, wrappedOwner, msg.sender);
        }
    }

    function _unwrapETH2LD(
        bytes32 labelhash,
        address wrappedOwner,
        address sender
    ) private {
        uint256 tokenId = uint256(labelhash);
        address registrant = registrar.ownerOf(tokenId);

        require(
            approvedWrapper[sender] &&
                sender == registrant &&
                registrar.isApprovedForAll(registrant, address(this)),
            "Unauthorised"
        );

        registrar.reclaim(tokenId, wrappedOwner);
        registrar.transferFrom(registrant, wrappedOwner, tokenId);
    }

    function _unwrapSubnode(
        bytes32 node,
        address newOwner,
        address sender
    ) private {
        address owner = ecns.owner(node);

        require(
            approvedWrapper[sender] &&
                owner == sender &&
                ecns.isApprovedForAll(owner, address(this)),
            "Unauthorised"
        );

        ecns.setOwner(node, newOwner);
    }

    function _makeNode(
        bytes32 node,
        bytes32 labelhash
    ) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(node, labelhash));
    }
}
