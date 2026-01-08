package repository

import (
	"errors"
	"time"

	"awsemchat/internal/database"
	"awsemchat/internal/models"

	"gorm.io/gorm"
)

type WalletRepository struct{}

func NewWalletRepository() *WalletRepository {
	return &WalletRepository{}
}

func (r *WalletRepository) GetByUserID(userID uint) (*models.Wallet, error) {
	var wallet models.Wallet
	err := database.DB.Where("user_id = ?", userID).First(&wallet).Error
	return &wallet, err
}

func (r *WalletRepository) Transfer(senderID, receiverID uint, amount float64, note string) error {
	return database.DB.Transaction(func(tx *gorm.DB) error {
		var senderWallet, receiverWallet models.Wallet

		// Lock sender row for update to prevent race conditions
		if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("user_id = ?", senderID).First(&senderWallet).Error; err != nil {
			return err
		}

		if senderWallet.Balance < amount {
			return errors.New("insufficient balance")
		}

		// Lock receiver row
		if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("user_id = ?", receiverID).First(&receiverWallet).Error; err != nil {
			return err
		}

		// Update balances
		senderWallet.Balance -= amount
		receiverWallet.Balance += amount

		if err := tx.Save(&senderWallet).Error; err != nil {
			return err
		}

		if err := tx.Save(&receiverWallet).Error; err != nil {
			return err
		}

		// Record Transaction
		transaction := models.Transaction{
			SenderWalletID:   senderWallet.ID,
			ReceiverWalletID: receiverWallet.ID,
			Amount:           amount,
			Type:             "transfer",
			Note:             note,
			CreatedAt:        time.Now(),
		}

		if err := tx.Create(&transaction).Error; err != nil {
			return err
		}

		return nil
	})
}
