// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import { IERC165Upgradeable, ERC165Upgradeable } from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IBaseRefundClaimer } from "../interfaces/IBaseRefundClaimer.sol";
import { IRefundIDO } from "../interfaces/IRefundIDO.sol";
import { BaseRoleChecker } from "../BaseRoleChecker.sol";

import { UQ112x112 } from "../libraries/UQ112x112.sol";

abstract contract BaseRefundClaimer is
    IBaseRefundClaimer,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC165Upgradeable,
    BaseRoleChecker
{
    using SafeERC20 for IERC20;

    bytes32 public constant ROLE_REFUND_CLAIMER = keccak256("ROLE_REFUND_CLAIMER");

    // [token][identifier][account]
    mapping(address => mapping(address => mapping(address => uint256))) public override refundClaimedInBuyToken;

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;

    constructor() initializer {}

    function initialize(
        address registry_,
        address token_,
        address identifier_,
        bytes calldata
    ) external virtual;

    function claimRefund(ClaimRefundData[] calldata claimRefundData_) external nonReentrant {
        _claimRefund(msg.sender, claimRefundData_);
    }

    function claimRefundForAccount(address account_, ClaimRefundData[] calldata claimRefundData_)
        external
        nonReentrant
        onlyRole(ROLE_REFUND_CLAIMER)
    {
        require(account_ != address(0), "BRC:Z");
        _claimRefund(account_, claimRefundData_);
    }

    function supportsInterface(bytes4 interfaceId_) public view virtual override returns (bool) {
        return interfaceId_ == type(IBaseRefundClaimer).interfaceId || super.supportsInterface(interfaceId_);
    }

    function _baseInitialize(address registry_) internal {
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        __ERC165_init();
        __BaseRoleChecker_init(registry_);
    }

    /**
     * @inheritdoc UUPSUpgradeable
     */
    function _authorizeUpgrade(address contract_) internal view override onlyRole(DEFAULT_ADMIN_ROLE) {
        require(IERC165(contract_).supportsInterface(type(IBaseRefundClaimer).interfaceId), "BRC:I");
    }

    function _isValidForRefund(
        address token_,
        address identifier_,
        address account_,
        bytes calldata
    ) internal view virtual;

    function _getRefundAmountInIDOToken(
        address token_,
        address identifier,
        address account_,
        bytes calldata
    ) internal view virtual returns (uint256 amount);

    function _claimRefund(address account_, ClaimRefundData[] calldata claimRefundData_) private {
        for (uint256 i; i < claimRefundData_.length; ++i) {
            address token = claimRefundData_[i].token;
            address identifier = claimRefundData_[i].identifier;
            _isValidForRefund(token, identifier, account_, claimRefundData_[i].data);

            uint256 amountInBuyToken = _calculateRefundAmountInBuyToken(
                token,
                identifier,
                account_,
                claimRefundData_[i].data
            );
            if (amountInBuyToken == 0) {
                continue;
            }

            IERC20(token).safeTransfer(account_, amountInBuyToken);
            refundClaimedInBuyToken[token][identifier][account_] += amountInBuyToken;

            emit ClaimRefund(msg.sender, token, identifier, account_, amountInBuyToken);
        }
    }

    function _calculateRefundAmountInBuyToken(
        address token_,
        address identifier_,
        address account_,
        bytes calldata data_
    ) private view returns (uint256) {
        uint256 pricePerTokenInUQ = IRefundIDO(identifier_).pricePerTokenInUQ();
        uint256 amountInBuyToken = (_getRefundAmountInIDOToken(token_, identifier_, account_, data_) *
            pricePerTokenInUQ) / UQ112x112.Q112;

        uint256 totalRefundClaimedInBuyToken = refundClaimedInBuyToken[token_][identifier_][account_];
        if (amountInBuyToken <= totalRefundClaimedInBuyToken) {
            return 0;
        }

        return amountInBuyToken - totalRefundClaimedInBuyToken;
    }
}
