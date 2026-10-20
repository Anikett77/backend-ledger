const transactionModel = require("../models/transaction.model")
const ledgerModel = require("../models/ledger.model")
const accountModel = require("../models/account.model")
const mongoose = require("mongoose")

/**
 * - Create a new transaction
 * THE 10-STEP TRANSFER FLOW:
     * 1. Validate request
    * 2. Validate idempotency key
    * 3. Check account status
    * 4. Derive sender balance from ledger
    * 5. Create transaction (PENDING)
    * 6. Create DEBIT ledger entry
    * 7. Create CREDIT ledger entry
    * 8. Mark transaction COMPLETED
    * 9. Commit MongoDB session
    * 10. Send email notification
 */

async function createTransaction(req, res) {

    /**
     * 1. Validate request
     */
    const { fromAccount, toAccount, amount, idempotencyKey } = req.body

    if (!fromAccount || !toAccount || amount === undefined || amount === null || !idempotencyKey) {
        return res.status(400).json({
            message: "FromAccount, toAccount, amount and idempotencyKey are required"
        })
    }

    const numericAmount = Number(amount)

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({
            message: "Amount must be a positive number"
        })
    }

    if (String(fromAccount) === String(toAccount)) {
        return res.status(400).json({
            message: "fromAccount and toAccount cannot be the same"
        })
    }

    const fromUserAccount = await accountModel.findOne({
        _id: fromAccount,
    })

    const toUserAccount = await accountModel.findOne({
        _id: toAccount,
    })

    if (!fromUserAccount || !toUserAccount) {
        return res.status(400).json({
            message: "Invalid fromAccount or toAccount"
        })
    }

    if (String(fromUserAccount.user) !== String(req.user._id)) {
        return res.status(403).json({
            message: "You can only transfer from your own account"
        })
    }

    /**
     * 2. Validate idempotency key
     */

    const isTransactionAlreadyExists = await transactionModel.findOne({
        idempotencyKey: idempotencyKey
    })

    if (isTransactionAlreadyExists) {
        if (isTransactionAlreadyExists.status === "COMPLETED") {
            return res.status(200).json({
                message: "Transaction already processed",
                transaction: isTransactionAlreadyExists
            })

        }

        if (isTransactionAlreadyExists.status === "PENDING") {
            return res.status(200).json({
                message: "Transaction is still processing",
            })
        }

        if (isTransactionAlreadyExists.status === "FAILED") {
            return res.status(500).json({
                message: "Transaction processing failed, please retry"
            })
        }

        if (isTransactionAlreadyExists.status === "REVERSED") {
            return res.status(500).json({
                message: "Transaction was reversed, please retry"
            })
        }
    }

    /**
     * 3. Check account status
     */

    if (fromUserAccount.status !== "ACTIVE" || toUserAccount.status !== "ACTIVE") {
        return res.status(400).json({
            message: "Both fromAccount and toAccount must be ACTIVE to process transaction"
        })
    }

    /**
     * 4. Derive sender balance from ledger
     */
    const balance = await fromUserAccount.getBalance()

    if (balance < numericAmount) {
        return res.status(400).json({
            message: `Insufficient balance. Current balance is ${balance}. Requested amount is ${numericAmount}`
        })
    }

    const session = await mongoose.startSession()
    try {
        session.startTransaction()

        /**
         * 5. Create transaction (PENDING)
         */
        const [ transaction ] = await transactionModel.create([ {
            fromAccount,
            toAccount,
            amount: numericAmount,
            idempotencyKey,
            status: "PENDING"
        } ], { session })

        /**
         * 6. Create DEBIT ledger entry
         */
        await ledgerModel.create([ {
            account: fromAccount,
            amount: numericAmount,
            transaction: transaction._id,
            type: "DEBIT"
        } ], { session })

        /**
         * 7. Create CREDIT ledger entry
         */
        await ledgerModel.create([ {
            account: toAccount,
            amount: numericAmount,
            transaction: transaction._id,
            type: "CREDIT"
        } ], { session })

        /**
         * 8. Mark transaction COMPLETED
         */
        transaction.status = "COMPLETED"
        await transaction.save({ session })

        /**
         * 9. Commit MongoDB session
         */
        await session.commitTransaction()

        return res.status(201).json({
            message: "Transaction completed successfully",
            transaction
        })
    } catch (error) {
        await session.abortTransaction()

        return res.status(500).json({
            message: "Transaction failed, please retry after sometime",
        })
    } finally {
        session.endSession()
    }

}

async function createInitialFundsTransaction(req, res) {
    const { toAccount, amount, idempotencyKey } = req.body

    if (!toAccount || amount === undefined || amount === null || !idempotencyKey) {
        return res.status(400).json({
            message: "toAccount, amount and idempotencyKey are required"
        })
    }

    const numericAmount = Number(amount)

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({
            message: "Amount must be a positive number"
        })
    }

    const existingTransaction = await transactionModel.findOne({ idempotencyKey })

    if (existingTransaction) {
        if (existingTransaction.status === "COMPLETED") {
            return res.status(200).json({
                message: "Transaction already processed",
                transaction: existingTransaction
            })
        }

        return res.status(400).json({
            message: "A transaction with this idempotencyKey already exists",
            transaction: existingTransaction
        })
    }

    const toUserAccount = await accountModel.findOne({
        _id: toAccount,
    })

    if (!toUserAccount) {
        const accountOwnedByUser = await accountModel.findOne({ user: toAccount })

        if (accountOwnedByUser) {
            return res.status(400).json({
                message: "toAccount must be the account _id from POST /api/accounts, not the user _id",
                accountId: accountOwnedByUser._id
            })
        }

        return res.status(400).json({
            message: "Invalid toAccount"
        })
    }

    if (toUserAccount.status !== "ACTIVE") {
        return res.status(400).json({
            message: "toAccount must be ACTIVE to receive funds"
        })
    }

    const fromUserAccount = await accountModel.findOne({
        user: req.user._id
    })

    if (!fromUserAccount) {
        return res.status(400).json({
            message: "System user account not found. Login as the system user and POST /api/accounts/ first."
        })
    }

    if (String(fromUserAccount._id) === String(toUserAccount._id)) {
        return res.status(400).json({
            message: "System account and toAccount cannot be the same. Credit a user account, not the system account."
        })
    }

    const session = await mongoose.startSession()
    try {
        session.startTransaction()

        const [ transaction ] = await transactionModel.create([ {
            fromAccount: fromUserAccount._id,
            toAccount,
            amount: numericAmount,
            idempotencyKey,
            status: "PENDING"
        } ], { session })

        await ledgerModel.create([ {
            account: fromUserAccount._id,
            amount: numericAmount,
            transaction: transaction._id,
            type: "DEBIT"
        } ], { session })

        await ledgerModel.create([ {
            account: toAccount,
            amount: numericAmount,
            transaction: transaction._id,
            type: "CREDIT"
        } ], { session })

        transaction.status = "COMPLETED"
        await transaction.save({ session })

        await session.commitTransaction()

        return res.status(201).json({
            message: "Initial funds transaction completed successfully",
            transaction
        })
    } catch (error) {
        await session.abortTransaction()
        console.error("Initial funds transaction failed:", error)

        return res.status(500).json({
            message: "Initial funds transaction failed, please retry after sometime",
            error: error.message
        })
    } finally {
        session.endSession()
    }
}

module.exports = {
    createTransaction,
    createInitialFundsTransaction
}
