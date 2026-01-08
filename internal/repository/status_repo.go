package repository

import (
	"awsemchat/internal/database"
	"awsemchat/internal/models"
	"time"
)

type StatusRepository struct{}

func NewStatusRepository() *StatusRepository {
	return &StatusRepository{}
}

func (r *StatusRepository) Create(status *models.Status) error {
	status.CreatedAt = time.Now()
	// Default expiry 24 hours if not set
	if status.ExpiresAt.IsZero() {
		status.ExpiresAt = time.Now().Add(24 * time.Hour)
	}
	return database.DB.Create(status).Error
}

func (r *StatusRepository) GetFeed(userID uint) ([]models.Status, error) {
	// Ideally: fetch only from contacts.
	// MVP: Fetch all statuses that haven't expired.
	var statuses []models.Status
	err := database.DB.Where("expires_at > ?", time.Now()).Order("created_at desc").Find(&statuses).Error
	return statuses, err
}
