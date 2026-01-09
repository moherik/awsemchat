package models

import (
	"time"
)

type User struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Phone     string    `gorm:"uniqueIndex;not null" json:"phone"`
	PIN       string    `gorm:"uniqueIndex;not null" json:"pin"` // The unique ID visible to users (e.g. A1B2C)
	Name      string    `json:"name"`
	Bio       string    `json:"bio"` // Profile Bio
	Password  string    `json:"-"`   // Hashed password
	AvatarURL string    `json:"avatar_url"`
	FCMToken  string    `json:"fcm_token"`  // Firebase Cloud Messaging Token
	PublicKey string    `json:"public_key"` // Identity Key for E2E
	LastSeen  time.Time `json:"last_seen"`  // Timestamp of last disconnect
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Wallet struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"uniqueIndex;not null" json:"user_id"`
	Balance   float64   `gorm:"default:0" json:"balance"`
	Currency  string    `gorm:"default:'IDR'" json:"currency"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Transaction struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	SenderWalletID   uint      `json:"sender_wallet_id"`
	ReceiverWalletID uint      `json:"receiver_wallet_id"`
	Amount           float64   `json:"amount"`
	Type             string    `json:"type"` // "transfer", "payment"
	Note             string    `json:"note"`
	RelatedOrderID   *uint     `json:"related_order_id,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
}

type Product struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	SellerID    uint      `gorm:"index" json:"seller_id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Price       float64   `json:"price"`
	ImageURL    string    `json:"image_url"`
	IsActive    bool      `gorm:"default:true" json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
}

type Order struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	BuyerID     uint      `json:"buyer_id"`
	SellerID    uint      `json:"seller_id"`
	ProductID   uint      `json:"product_id"`
	Quantity    int       `json:"quantity"`
	TotalAmount float64   `json:"total_amount"`
	Status      string    `gorm:"default:'pending'" json:"status"` // pending, completed, cancelled
	CreatedAt   time.Time `json:"created_at"`
}

type Message struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	SenderID         uint      `gorm:"index" json:"sender_id"`
	RecipientID      *uint     `gorm:"index" json:"recipient_id,omitempty"` // Null if group
	GroupID          *uint     `gorm:"index" json:"group_id,omitempty"`
	Content          []byte    `json:"content"` // Encrypted blob
	Type             string    `json:"type"`    // text, image, money
	ReplyToStatusID  *uint     `json:"reply_to_status_id,omitempty"`
	ReplyToProductID *uint     `json:"reply_to_product_id,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
}

type Group struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	AdminID     uint      `json:"admin_id"`
	CreatedAt   time.Time `json:"created_at"`
}

type GroupMember struct {
	ID       uint      `gorm:"primaryKey" json:"id"`
	GroupID  uint      `gorm:"uniqueIndex:idx_group_user" json:"group_id"`
	UserID   uint      `gorm:"uniqueIndex:idx_group_user" json:"user_id"`
	JoinedAt time.Time `json:"joined_at"`
}

type Status struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"index" json:"user_id"`
	Content   []byte    `json:"content"`
	Caption   string    `json:"caption"`
	Products  []Product `gorm:"many2many:status_products;" json:"products,omitempty"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

type E2EKeys struct {
	ID        uint   `gorm:"primaryKey" json:"id"`
	UserID    uint   `gorm:"index" json:"user_id"`
	DeviceID  uint   `json:"device_id"`
	KeyType   string `json:"key_type"` // "prekey", "signed_prekey"
	KeyID     uint   `json:"key_id"`
	PublicKey string `json:"public_key"`
}

type Promotion struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	CreatorID uint      `json:"creator_id"`
	Content   string    `json:"content"`    // Text or description
	ImageURL  string    `json:"image_url"`  // Banner
	TargetURL string    `json:"target_url"` // e.g. "awsemchat://products/123"
	ExpiresAt time.Time `json:"expires_at"` // Ads expire too
	CreatedAt time.Time `json:"created_at"`
}

type PaymentRequest struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	RequesterID uint      `json:"requester_id"`
	Amount      float64   `json:"amount"`
	Note        string    `json:"note"`                            // "Split Bill", etc
	Status      string    `gorm:"default:'pending'" json:"status"` // pending, paid, cancelled
	PayerID     *uint     `json:"payer_id,omitempty"`              // Who paid it
	CreatedAt   time.Time `json:"created_at"`
}

type VerificationCode struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Phone     string    `gorm:"index;not null" json:"phone"`
	Code      string    `json:"code"`
	IsActive  bool      `gorm:"default:true" json:"is_active"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

type Block struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	BlockerID uint      `gorm:"uniqueIndex:idx_blocker_blocked" json:"blocker_id"`
	BlockedID uint      `gorm:"uniqueIndex:idx_blocker_blocked" json:"blocked_id"`
	CreatedAt time.Time `json:"created_at"`
}
