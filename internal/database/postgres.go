package database

import (
	"log"

	"awsemchat/internal/models"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

func Connect(dsn string) {
	var err error
	DB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	log.Println("Database connection established")
}

func Migrate() {
	err := DB.AutoMigrate(
		&models.User{},
		&models.Wallet{},
		&models.Transaction{},
		&models.Product{},
		&models.Order{},
		&models.Message{},
		&models.Group{},
		&models.GroupMember{},
		&models.Status{},
		&models.E2EKeys{},
		&models.Promotion{},
		&models.PaymentRequest{},
		&models.VerificationCode{},
		&models.Block{},
	)
	if err != nil {
		log.Fatal("Failed to migrate database:", err)
	}
	log.Println("Database migration completed")
}
