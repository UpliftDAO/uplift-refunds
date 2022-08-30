// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.8;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../libraries/BP.sol";

contract TestDeflationaryERC20 is ERC20 {
    uint256 public deflationaryInBP;

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply,
        uint256 _deflationaryInBP
    ) ERC20(_name, _symbol) {
        _mint(msg.sender, _initialSupply);
        deflationaryInBP = _deflationaryInBP;
    }

    function burn(address account, uint256 amount) external {
        _burn(account, amount);
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     * - the caller must have a balance of at least `amount`.
     */
    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        address owner = _msgSender();
        _transfer(owner, to, amount);
        uint256 burnAmount = (amount * deflationaryInBP) / BP.DECIMAL_FACTOR;
        _burn(to, burnAmount);

        return true;
    }

    /**
     * @dev See {IERC20-transferFrom}.
     *
     * Emits an {Approval} event indicating the updated allowance. This is not
     * required by the EIP. See the note at the beginning of {ERC20}.
     *
     * NOTE: Does not update the allowance if the current allowance
     * is the maximum `uint256`.
     *
     * Requirements:
     *
     * - `from` and `to` cannot be the zero address.
     * - `from` must have a balance of at least `amount`.
     * - the caller must have allowance for ``from``'s tokens of at least
     * `amount`.
     */
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public virtual override returns (bool) {
        address spender = _msgSender();
        _spendAllowance(from, spender, amount);
        _transfer(from, to, amount);
        uint256 burnAmount = (amount * deflationaryInBP) / BP.DECIMAL_FACTOR;
        _burn(to, burnAmount);

        return true;
    }
}
