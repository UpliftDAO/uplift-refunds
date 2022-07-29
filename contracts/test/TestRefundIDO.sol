// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { ERC165 } from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

import { IRefundIDO } from "../interfaces/IRefundIDO.sol";
import { IPool } from "../interfaces/IPool.sol";

contract TestRefundIDO is IRefundIDO, ERC165 {
    address public referralPool;
    uint256 public override pricePerTokenInUQ;

    mapping(address => uint256) public override amountOf;
    mapping(address => Referrer[]) private referrersOf;

    function addAccount(
        address account_,
        uint256 amount_,
        address parent_,
        address grandparent_
    ) external {
        amountOf[account_] = amount_;
        IPool(referralPool).mint(parent_, amount_);
        IPool(referralPool).mint(grandparent_, amount_);
        referrersOf[account_].push(Referrer(parent_, amount_));
        referrersOf[account_].push(Referrer(grandparent_, amount_));
    }

    function setBaseInfo(address referralPool_, uint256 pricePerTokenInUQ_) external {
        referralPool = referralPool_;
        pricePerTokenInUQ = pricePerTokenInUQ_;
    }

    function referrersInfoOf(address account_)
        external
        view
        returns (address referralPool_, Referrer[] memory referrers_)
    {
        referralPool_ = referralPool;
        referrers_ = referrersOf[account_];
    }

    function supportsInterface(bytes4 interfaceId_) public view virtual override returns (bool) {
        return interfaceId_ == type(IRefundIDO).interfaceId || super.supportsInterface(interfaceId_);
    }
}
