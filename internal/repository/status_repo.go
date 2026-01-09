package repository

import (
	"time"

	"awsemchat/internal/database"
	"awsemchat/internal/models"
)

type StatusRepository struct{}

func NewStatusRepository() *StatusRepository {
	return &StatusRepository{}
}

func (r *StatusRepository) Create(status *models.Status) error {
	tx := database.DB.Begin()

	status.ExpiresAt = time.Now().Add(24 * time.Hour) // Enforce 24h expiry
	if err := tx.Create(status).Error; err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit().Error
}

func (r *StatusRepository) GetActiveStatuses(userID uint) ([]models.Status, error) {
	var statuses []models.Status

	err := database.DB.Table("statuses").
		Select("statuses.*").
		Preload("Products").
		Order("statuses.created_at desc").
		Find(&statuses).Error

	if err != nil {
		return nil, err
	}
	return statuses, nil
}

func (r *StatusRepository) CleanupExpired() error {
	// Hard Delete expired statuses
	return database.DB.Where("expires_at < ?", time.Now()).Delete(&models.Status{}).Error
}
