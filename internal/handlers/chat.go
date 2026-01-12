package handlers

import (
	"net/http"

	"awsemchat/internal/websocket"

	ws "github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

var (
	upgrader = ws.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return true // Allow all origins for dev
		},
	}

	// Global Hub instance, to be started in main
	Hub *websocket.Hub
)

func ServeWS(c echo.Context) error {
	userID := c.Get("user_id").(uint)
	deviceID := c.Get("device_id").(uint)

	w := c.Response().Writer
	r := c.Request()

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return err
	}

	client := &websocket.Client{
		Hub:      Hub,
		Conn:     conn,
		Send:     make(chan *websocket.MessagePayload, 256),
		UserID:   userID,
		DeviceID: deviceID,
	}

	client.Hub.Register <- client

	// Allow collection of memory referenced by the caller by doing all work in
	// new goroutines.
	go client.WritePump()
	go client.ReadPump()

	return nil
}
