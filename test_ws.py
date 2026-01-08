import websocket
import _thread
import time
import json
import ssl

def on_message(ws, message):
    print(f"Received: {message}")

def on_error(ws, error):
    print(f"Error: {error}")

def on_close(ws, close_status_code, close_msg):
    print("### closed ###")

def on_open_user1(ws):
    print("User 1 Connected")
    def run(*args):
        time.sleep(2)
        # Send message to User 2 (ID: 3 from previous curl steps)
        # payload to match MessagePayload struct
        msg = {
            "receiver_id": 3,
            "content": "SGVsbG8gV29ybGQ=", # Base64 "Hello World"
            "type": "text"
        }
        ws.send(json.dumps(msg))
        print("User 1 Sent Message")
    _thread.start_new_thread(run, ())

def on_open_user2(ws):
    print("User 2 Connected")

if __name__ == "__main__":
    # Tokens from previous curl output
    # User 1 (ID 1): eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxLCJleHAiOjE3NjgxMTkyNDl9.Jm9bN6ZguyzLygErN9iv4NqjqsdJj6J0e-UaqshcBUA
    # User 2 (ID 3): eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjozLCJleHAiOjE3NjgxMTkyNTR9.u2JrqU08UcrVlLKkVQ_g3gT1JEXkDM_u_LOzfIS16c0
    
    token1 = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxLCJleHAiOjE3NjgxMTkyNDl9.Jm9bN6ZguyzLygErN9iv4NqjqsdJj6J0e-UaqshcBUA"
    token2 = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjozLCJleHAiOjE3NjgxMTkyNTR9.u2JrqU08UcrVlLKkVQ_g3gT1JEXkDM_u_LOzfIS16c0"

    # Start User 2 Listener
    ws2 = websocket.WebSocketApp(
        "ws://localhost:8080/api/v1/ws",
        on_open=on_open_user2,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
        header={"Authorization": f"Bearer {token2}"}
    )
    
    _thread.start_new_thread(ws2.run_forever, ())
    
    time.sleep(1)

    # Start User 1 Sender
    ws1 = websocket.WebSocketApp(
        "ws://localhost:8080/api/v1/ws",
        on_open=on_open_user1,
        on_message=on_message, # User 1 might receive ack or other msgs
        on_error=on_error,
        on_close=on_close,
        header={"Authorization": f"Bearer {token1}"}
    )
    
    ws1.run_forever()
