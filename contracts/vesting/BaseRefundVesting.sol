// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import { ERC165Upgradeable } from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IBaseRefundVesting } from "../interfaces/IBaseRefundVesting.sol";
import { IBaseRefundRequester } from "../interfaces/IBaseRefundRequester.sol";
import { BaseRoleChecker } from "../BaseRoleChecker.sol";

abstract contract BaseRefundVesting is
    IBaseRefundVesting,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC165Upgradeable,
    BaseRoleChecker
{
    using SafeERC20 for IERC20;

    // [token][identifier]
    mapping(address => mapping(address => address)) public override refundOf;
    // [token][identifier][account]
    mapping(address => mapping(address => mapping(address => uint256))) public override claimed;

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;

    constructor() initializer {}

    function initialize(
        address registry_,
        InitializeInfo calldata initializeInfo_,
        bytes calldata
    ) external virtual;

    function addTokenInfo(InitializeInfo calldata, bytes calldata) external virtual override;

    function setRefund(
        address token_,
        address identifier_,
        address refund_
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _setRefund(token_, identifier_, refund_);
    }

    function withdraw(address token_, address identifier_) external override nonReentrant {
        uint256 availableForWithdrawInIDOTokens = withdrawableOf(token_, identifier_, msg.sender);
        require(availableForWithdrawInIDOTokens > 0, "BRV:Z");
        claimed[token_][identifier_][msg.sender] += availableForWithdrawInIDOTokens;
        uint256 balance = IERC20(token_).balanceOf(msg.sender);
        IERC20(token_).safeTransfer(msg.sender, availableForWithdrawInIDOTokens);
        uint256 newBalance = IERC20(token_).balanceOf(msg.sender);
        uint256 receivedAmountInIDOTokens = newBalance >= balance ? newBalance - balance : 0;
        emit Withdraw(token_, identifier_, msg.sender, availableForWithdrawInIDOTokens, receivedAmountInIDOTokens);
    }

    function withdrawableOf(
        address token_,
        address identifier_,
        address account_
    ) public view override returns (uint256) {
        uint256 total = _getTotalOf(identifier_, account_);
        if (total == 0) {
            return 0;
        }
        uint256 totalClaimed = claimed[token_][identifier_][account_];
        address refund = refundOf[token_][identifier_];
        if (refund != address(0)) {
            // Claim + refunded - refundedClaimed
            IBaseRefundRequester.ReturnRefundInfo memory info = IBaseRefundRequester(refund).infoOf(
                token_,
                identifier_,
                account_
            );
            totalClaimed += info.accountInfoOf.refundRequestedInToken;
            totalClaimed -= info.accountInfoOf.claimedRefundRequestedInToken;
        }
        return _withdrawableOf(token_, identifier_, total, totalClaimed);
    }

    function supportsInterface(bytes4 interfaceId_) public view virtual override returns (bool) {
        return interfaceId_ == type(IBaseRefundVesting).interfaceId || super.supportsInterface(interfaceId_);
    }

    function _baseInitialize(address registry_, InitializeInfo calldata initializeInfo_) internal {
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        __ERC165_init();
        __BaseRoleChecker_init(registry_);

        _setInitializeInfo(initializeInfo_);
    }

    /**
     * @inheritdoc UUPSUpgradeable
     */
    function _authorizeUpgrade(address contract_) internal view override onlyRole(DEFAULT_ADMIN_ROLE) {
        require(IERC165(contract_).supportsInterface(type(IBaseRefundVesting).interfaceId), "BRV:I");
    }

    function _setInitializeInfo(InitializeInfo calldata initializeInfo_) internal {
        require(initializeInfo_.token != address(0), "BRV:Z");
        _checkIdentifier(initializeInfo_.identifier);
        if (initializeInfo_.refund != address(0)) {
            _setRefund(initializeInfo_.token, initializeInfo_.identifier, initializeInfo_.refund);
        }
    }

    function _checkIdentifier(address _identifier) internal view virtual;

    function _baseInfoOf(
        address token_,
        address identifier_,
        address account_
    ) internal view returns (ReturnInfo memory refundInfo) {
        refundInfo.refund = refundOf[token_][identifier_];
        refundInfo.total = _getTotalOf(identifier_, account_);
        refundInfo.totalClaimed = claimed[token_][identifier_][account_];
        refundInfo.withdrawableAmount = withdrawableOf(token_, identifier_, account_);
    }

    function _withdrawableOf(
        address token_,
        address identifier_,
        uint256 total_,
        uint256 vested_
    ) internal view virtual returns (uint256);

    function _getTotalOf(address identifier_, address account_) internal view virtual returns (uint256);

    function _setRefund(
        address token_,
        address identifier_,
        address refund_
    ) private {
        require(IERC165(refund_).supportsInterface(type(IBaseRefundRequester).interfaceId), "BRV:I");
        refundOf[token_][identifier_] = refund_;
        emit SetRefund(token_, identifier_, refund_);
    }
}
