package repository

import (
	"awsemchat/internal/database"
	"awsemchat/internal/models"
)

type KeyRepository struct{}

func NewKeyRepository() *KeyRepository {
	return &KeyRepository{}
}

func (r *KeyRepository) UpsertKeys(keys []models.E2EKeys) error {
	// This is a naive implementation. In reality, we might want to handle batches more carefully.
	// For now, we just loop and create.
	for _, key := range keys {
		if err := database.DB.Create(&key).Error; err != nil {
			return err
		}
	}
	return nil
}

func (r *KeyRepository) GetKeys(userID uint, deviceID uint) ([]models.E2EKeys, error) {
	var keys []models.E2EKeys
	err := database.DB.Where("user_id = ? AND device_id = ?", userID, deviceID).Find(&keys).Error
	return keys, err
}

func (r *KeyRepository) GetOneTimePreKey(userID uint) (*models.E2EKeys, error) {
	var key models.E2EKeys
	// Fetch one prekey and delete it (OTPK rule), or just fetch if we want to delete later.
	// Signal protocol usually consumes prekeys.
	// For simplicity here, we just fetch one that is a "prekey"
	err := database.DB.Where("user_id = ? AND key_type = ?", userID, "prekey").First(&key).Error
	if err != nil {
		return nil, err
	}

	// In a real implementation, we should delete this key or mark it as used within a transaction
	return &key, nil
}

func (r *KeyRepository) DeleteKey(id uint) error {
	return database.DB.Delete(&models.E2EKeys{}, id).Error
}
