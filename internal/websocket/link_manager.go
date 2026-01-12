package websocket

import (
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type LinkManager struct {
	// Map LinkCode -> WebSocket Connection
	pendingLinks sync.Map
}

var GlobalLinkManager = &LinkManager{}

type LinkSession struct {
	Conn      *websocket.Conn
	CreatedAt time.Time
}

func (lm *LinkManager) NewSession(conn *websocket.Conn) string {
	code := uuid.New().String()
	lm.pendingLinks.Store(code, &LinkSession{
		Conn:      conn,
		CreatedAt: time.Now(),
	})

	// Auto cleanup after 2 minutes
	go func() {
		time.Sleep(2 * time.Minute)
		if _, ok := lm.pendingLinks.Load(code); ok {
			conn.Close()
			lm.pendingLinks.Delete(code)
		}
	}()

	return code
}

func (lm *LinkManager) AuthorizeSession(code string, authPayload interface{}) bool {
	val, ok := lm.pendingLinks.Load(code)
	if !ok {
		return false
	}

	session := val.(*LinkSession)

	// Send Auth Payload
	if err := session.Conn.WriteJSON(authPayload); err != nil {
		log.Printf("Failed to send auth payload to linked device: %v", err)
		return false
	}

	// Close connection (Client should now reconnect with Token)
	// Or keep open? Usually better to close so client reconnects to Main WS with token.
	// Let's send payload then close.
	session.Conn.Close()
	lm.pendingLinks.Delete(code)
	return true
}
