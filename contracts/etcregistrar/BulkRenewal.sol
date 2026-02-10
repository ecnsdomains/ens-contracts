//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import "../registry/ECNS.sol";
import "./ETCRegistrarController.sol";
import "./IETCRegistrarController.sol";
import "../resolvers/Resolver.sol";
import "./IBulkRenewal.sol";
import "./IPriceOracle.sol";

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract BulkRenewal is IBulkRenewal {
    bytes32 private constant ETC_NAMEHASH =
        0x2f142013fcc88d47bffe42e5d883f6081cbaa75abaa20e7f34f3043bbc8162c9;

    ECNS public immutable ecns;

    constructor(ECNS _ecns) {
        ecns = _ecns;
    }

    function getController() internal view returns (ETCRegistrarController) {
        Resolver r = Resolver(ecns.resolver(ETC_NAMEHASH));
        return
            ETCRegistrarController(
                r.interfaceImplementer(
                    ETC_NAMEHASH,
                    type(IETCRegistrarController).interfaceId
                )
            );
    }

    function rentPrice(
        string[] calldata names,
        uint256 duration
    ) external view override returns (uint256 total) {
        ETCRegistrarController controller = getController();
        uint256 length = names.length;
        for (uint256 i = 0; i < length; ) {
            IPriceOracle.Price memory price = controller.rentPrice(
                names[i],
                duration
            );
            unchecked {
                ++i;
                total += (price.base + price.premium);
            }
        }
    }

    function renewAll(
        string[] calldata names,
        uint256 duration,
        bytes32 referrer
    ) external payable override {
        ETCRegistrarController controller = getController();
        uint256 length = names.length;
        uint256 total;
        for (uint256 i = 0; i < length; ) {
            IPriceOracle.Price memory price = controller.rentPrice(
                names[i],
                duration
            );
            uint256 totalPrice = price.base + price.premium;
            controller.renew{value: totalPrice}(names[i], duration, referrer);
            unchecked {
                ++i;
                total += totalPrice;
            }
        }
        // Send any excess funds back
        payable(msg.sender).transfer(address(this).balance);
    }

    function supportsInterface(
        bytes4 interfaceID
    ) external pure returns (bool) {
        return
            interfaceID == type(IERC165).interfaceId ||
            interfaceID == type(IBulkRenewal).interfaceId;
    }
}
