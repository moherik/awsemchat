package repository

import (
	"errors"
	"strconv"
	"time"

	"awsemchat/internal/database"
	"awsemchat/internal/models"

	"gorm.io/gorm"
)

type StoreRepository struct{}

func NewStoreRepository() *StoreRepository {
	return &StoreRepository{}
}

func (r *StoreRepository) CreateProduct(product *models.Product) error {
	return database.DB.Create(product).Error
}

func (r *StoreRepository) GetUserProducts(userID uint) ([]models.Product, error) {
	var products []models.Product
	err := database.DB.Where("seller_id = ? AND is_active = ?", userID, true).Find(&products).Error
	return products, err
}

func (r *StoreRepository) GetProduct(productID uint) (*models.Product, error) {
	var product models.Product
	err := database.DB.First(&product, productID).Error
	return &product, err
}

// Purchase handles the financial transaction and order creation
func (r *StoreRepository) Purchase(buyerID uint, productID uint, quantity int) (*models.Order, error) {
	var order models.Order

	err := database.DB.Transaction(func(tx *gorm.DB) error {
		// 1. Get Product
		var product models.Product
		if err := tx.First(&product, productID).Error; err != nil {
			return err
		}

		if !product.IsActive {
			return errors.New("product unavailable")
		}

		// 2. Calculate Total
		totalAmount := product.Price * float64(quantity)

		// 3. Get Wallets (Locking)
		var buyerWallet, sellerWallet models.Wallet

		if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("user_id = ?", buyerID).First(&buyerWallet).Error; err != nil {
			return err
		}

		if buyerWallet.Balance < totalAmount {
			return errors.New("insufficient balance")
		}

		if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("user_id = ?", product.SellerID).First(&sellerWallet).Error; err != nil {
			return err
		}

		// 4. Transfer Money
		buyerWallet.Balance -= totalAmount
		sellerWallet.Balance += totalAmount

		tx.Save(&buyerWallet)
		tx.Save(&sellerWallet)

		// 5. Create Order
		order = models.Order{
			BuyerID:     buyerID,
			SellerID:    product.SellerID,
			ProductID:   product.ID,
			Quantity:    quantity,
			TotalAmount: totalAmount,
			Status:      "completed", // Instant fulfillment for digital/simple goods
			CreatedAt:   time.Now(),
		}

		if err := tx.Create(&order).Error; err != nil {
			return err
		}

		// 6. Record Transaction
		transaction := models.Transaction{
			SenderWalletID:   buyerWallet.ID,
			ReceiverWalletID: sellerWallet.ID,
			Amount:           totalAmount,
			Type:             "payment",
			Note:             "Order #" + strconv.Itoa(int(order.ID)), // Casting might be tricky here before commit, but ID is usually set.
			RelatedOrderID:   &order.ID,
			CreatedAt:        time.Now(),
		}
		// Let's assume ID is populated.

		if err := tx.Create(&transaction).Error; err != nil {
			return err
		}

		// TODO: Notify Seller via WebSocket?

		return nil
	})

	return &order, err
}
