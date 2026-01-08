package repository

import (
	"errors"
	"time"

	"awsemchat/internal/database"
	"awsemchat/internal/models"

	"gorm.io/gorm"
)

type PaymentRequestRepository struct{}

func NewPaymentRequestRepository() *PaymentRequestRepository {
	return &PaymentRequestRepository{}
}

func (r *PaymentRequestRepository) Create(req *models.PaymentRequest) error {
	req.CreatedAt = time.Now()
	req.Status = "pending"
	return database.DB.Create(req).Error
}

func (r *PaymentRequestRepository) GetByID(id uint) (*models.PaymentRequest, error) {
	var req models.PaymentRequest
	if err := database.DB.First(&req, id).Error; err != nil {
		return nil, err
	}
	return &req, nil
}

func (r *PaymentRequestRepository) Pay(reqID, payerID uint) error {
	return database.DB.Transaction(func(tx *gorm.DB) error {
		// 1. Fetch Request
		var req models.PaymentRequest
		if err := tx.Set("gorm:query_option", "FOR UPDATE").First(&req, reqID).Error; err != nil {
			return err
		}

		if req.Status != "pending" {
			return errors.New("payment request already processed")
		}

		if req.RequesterID == payerID {
			return errors.New("cannot pay your own request")
		}

		// 2. Fetch Wallets
		var payerWallet, receiverWallet models.Wallet
		if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("user_id = ?", payerID).First(&payerWallet).Error; err != nil {
			return err
		}

		if payerWallet.Balance < req.Amount {
			return errors.New("insufficient balance")
		}

		if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("user_id = ?", req.RequesterID).First(&receiverWallet).Error; err != nil {
			return err
		}

		// 3. Transfer
		payerWallet.Balance -= req.Amount
		receiverWallet.Balance += req.Amount

		if err := tx.Save(&payerWallet).Error; err != nil {
			return err
		}
		if err := tx.Save(&receiverWallet).Error; err != nil {
			return err
		}

		// 4. Update Request Status
		req.Status = "paid"
		req.PayerID = &payerID
		if err := tx.Save(&req).Error; err != nil {
			return err
		}

		// 5. Record Transaction
		transaction := models.Transaction{
			SenderWalletID:   payerWallet.ID,
			ReceiverWalletID: receiverWallet.ID,
			Amount:           req.Amount,
			Type:             "payment_request",
			Note:             req.Note,
			CreatedAt:        time.Now(),
		}
		if err := tx.Create(&transaction).Error; err != nil {
			return err
		}

		return nil
	})
}
