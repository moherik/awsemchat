package models

import (
	"time"

	"gorm.io/gorm"
)

type CallLog struct {
	ID         uint           `gorm:"primaryKey" json:"id"`
	SenderID   uint           `gorm:"index" json:"sender_id"`
	ReceiverID uint           `gorm:"index" json:"receiver_id"`
	Type       string         `json:"type"`   // "audio", "video"
	Status     string         `json:"status"` // "missed", "completed", "rejected", "busy"
	StartedAt  time.Time      `json:"started_at"`
	EndedAt    *time.Time     `json:"ended_at,omitempty"`
	Duration   int            `json:"duration,omitempty"` // Seconds
	CreatedAt  time.Time      `json:"created_at"`
	DeletedAt  gorm.DeletedAt `gorm:"index" json:"-"`
}
