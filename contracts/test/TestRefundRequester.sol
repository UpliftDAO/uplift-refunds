// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { ERC165 } from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IBaseRefundRequester } from "../interfaces/IBaseRefundRequester.sol";

contract TestRefundRequester is IBaseRefundRequester, ERC165 {
    using SafeERC20 for IERC20;

    KPI[] public KPIs;
    uint8 public currentKPIIndex;
    address public token;

    mapping(address => mapping(address => uint256)) public claimedRefundRequested;
    mapping(address => mapping(address => uint256)) public refundRequested;
    mapping(address => mapping(address => mapping(uint8 => uint256))) public refundRequestedByKPI;
    mapping(address => mapping(address => mapping(uint8 => uint256))) public actualRefundRequestedByKPI;

    constructor(KPI[] memory KPIs_, address token_) {
        for (uint256 i; i < KPIs_.length; ++i) {
            KPIs.push(KPIs_[i]);
        }
        token = token_;
    }

    function setRefundable(
        address,
        address,
        uint8,
        bool
    ) external override {}

    function setCurrentKPIIndex(uint8 index_) external {
        currentKPIIndex = index_;
    }

    function setProjectFundsHolder(
        address token_,
        address identifier_,
        address projectFundsHolder_
    ) external {}

    function setKPI(
        address token_,
        address identifier_,
        uint8 KPIIndex_,
        KPI calldata KPI_
    ) external {}

    function setClaimableKPI(
        address,
        address,
        uint8 KPIIndex_,
        bool isClaimable_
    ) external {
        KPIs[KPIIndex_].isClaimable = isClaimable_;
    }

    function requestRefund(
        address,
        address,
        uint256,
        uint8,
        bytes calldata
    ) external {}

    function testRequestRefund(
        uint256 returnClaimed_,
        uint256 actualReturnClaimed_,
        address identifier_,
        bool isReturn_
    ) external {
        refundRequested[identifier_][msg.sender] += returnClaimed_;
        refundRequestedByKPI[identifier_][msg.sender][currentKPIIndex] += returnClaimed_;
        actualRefundRequestedByKPI[identifier_][msg.sender][currentKPIIndex] += actualReturnClaimed_;
        if (isReturn_) {
            claimedRefundRequested[identifier_][msg.sender] += returnClaimed_;
            IERC20(token).safeTransferFrom(msg.sender, address(this), returnClaimed_);
        }
    }

    function infoOf(
        address,
        address identifier_,
        address account_
    ) external view returns (ReturnRefundInfo memory info) {
        info.KPIs = KPIs;
        info.accountInfoOf.refundRequestedInToken = refundRequested[identifier_][account_];
        info.accountInfoOf.claimedRefundRequestedInToken = claimedRefundRequested[identifier_][account_];
        uint256 length = KPIs.length;
        info.accountInfoOf.refundRequestedWithMultiplierByKPIInToken = new uint256[](length);
        info.accountInfoOf.actualRefundRequestedWithMultiplierByKPIInToken = new uint256[](length);
        for (uint256 i; i < length; ++i) {
            info.accountInfoOf.refundRequestedWithMultiplierByKPIInToken[i] = refundRequestedByKPI[identifier_][
                account_
            ][uint8(i)];
            info.accountInfoOf.actualRefundRequestedWithMultiplierByKPIInToken[i] = actualRefundRequestedByKPI[
                identifier_
            ][account_][uint8(i)];
        }
    }

    function supportsInterface(bytes4 interfaceId_) public view virtual override returns (bool) {
        return interfaceId_ == type(IBaseRefundRequester).interfaceId || super.supportsInterface(interfaceId_);
    }
}
