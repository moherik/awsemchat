package repository

import (
	"math/rand"
	"time"

	"awsemchat/internal/database"
	"awsemchat/internal/models"

	"gorm.io/gorm"
)

type UserRepository struct{}

func NewUserRepository() *UserRepository {
	return &UserRepository{}
}

func (r *UserRepository) Create(user *models.User) error {
	// Generate a unique PIN (6 chars alphanumeric)
	user.PIN = generatePIN()

	// Transaction to create User and Wallet
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(user).Error; err != nil {
			return err
		}

		wallet := models.Wallet{
			UserID:   user.ID,
			Balance:  0,
			Currency: "IDR",
		}
		if err := tx.Create(&wallet).Error; err != nil {
			return err
		}

		return nil
	})

	return err
}

func (r *UserRepository) FindByPhone(phone string) (*models.User, error) {
	var user models.User
	err := database.DB.Where("phone = ?", phone).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *UserRepository) FindByID(id uint) (*models.User, error) {
	var user models.User
	err := database.DB.First(&user, id).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *UserRepository) FindByPIN(pin string) (*models.User, error) {
	var user models.User
	err := database.DB.Where("pin = ?", pin).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *UserRepository) Update(user *models.User) error {
	return database.DB.Save(user).Error
}

func generatePIN() string {
	const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // Removed I, O, 0, 1 for clarity
	b := make([]byte, 6)
	rand.Seed(time.Now().UnixNano())
	for i := range b {
		b[i] = charset[rand.Intn(len(charset))]
	}
	return string(b)
}
