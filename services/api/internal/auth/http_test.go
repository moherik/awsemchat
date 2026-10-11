package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func invoke(handler http.Handler, method, path, body, token string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.RemoteAddr = "127.0.0.1:12345"
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	result := httptest.NewRecorder()
	handler.ServeHTTP(result, request)
	return result
}
func TestHTTPChallengesDoNotExposeCodesAndRevokedSessionIsDenied(t *testing.T) {
	t.Parallel()
	service, sms, _, now := fixture(t)
	handler := NewHandler(service, false)
	result := invoke(handler, "POST", "/v1/auth/challenges", `{"phone":"+6281234567890","deviceId":"device-one","operationId":"first"}`, "")
	if result.Code != http.StatusAccepted {
		t.Fatalf("POST challenge status=%d,want202", result.Code)
	}
	if strings.Contains(result.Body.String(), sms.code) || strings.Contains(result.Body.String(), "phone") {
		t.Error("Challenge response exposes phone/code")
	}
	var challenge Challenge
	if err := json.Unmarshal(result.Body.Bytes(), &challenge); err != nil {
		t.Fatal(err)
	}
	verifyBody, _ := json.Marshal(map[string]string{"challengeId": challenge.ID, "code": sms.code, "deviceId": "device-one"})
	verified := invoke(handler, "POST", "/v1/auth/verify", string(verifyBody), "")
	if verified.Code != http.StatusOK {
		t.Fatalf("Verify status=%d,want200", verified.Code)
	}
	var session Session
	if err := json.Unmarshal(verified.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if result := invoke(handler, "GET", "/v1/session", "", session.Token); result.Code != 200 {
		t.Fatalf("Current session status=%d,want200", result.Code)
	}
	*now = now.Add(time.Minute)
	second, code := challengeFor(t, service, sms, "device-two", "second")
	if _, err := service.Verify(context.Background(), VerifyInput{ChallengeID: second.ID, Code: code, DeviceID: "device-two"}); err != nil {
		t.Fatal(err)
	}
	if result := invoke(handler, "GET", "/v1/session", "", session.Token); result.Code != http.StatusUnauthorized {
		t.Errorf("Revoked session status=%d,want401", result.Code)
	}
	if result := invoke(handler, "POST", "/dev/otp", `{"phone":"+6281234567890"}`, ""); result.Code != http.StatusNotFound {
		t.Errorf("Production dev endpoint status=%d,want404", result.Code)
	}
}
func TestHTTPRejectsUnknownFieldsTrailingJSONAndWrongMethods(t *testing.T) {
	t.Parallel()
	service, sms, _, _ := fixture(t)
	handler := NewHandler(service, false)
	valid := `{"phone":"+6281234567890","deviceId":"device","operationId":"one"}`
	for _, body := range []string{valid + ` {}`, `{"phone":"+6281234567890","deviceId":"device","operationId":"one","network":"forged"}`} {
		if result := invoke(handler, "POST", "/v1/auth/challenges", body, ""); result.Code != 400 {
			t.Errorf("Invalid JSON status=%d,want400", result.Code)
		}
	}
	if result := invoke(handler, "GET", "/v1/auth/challenges", "", ""); result.Code != 405 {
		t.Errorf("Wrong method status=%d,want405", result.Code)
	}
	if sms.calls != 0 {
		t.Errorf("Malformed requests sent%dSMS,want0", sms.calls)
	}
}

func TestDevelopmentEndpointRequiresExplicitModeAndLoopback(t *testing.T) {
	t.Parallel()
	service, _, pool, _ := fixture(t)
	mock := NewDevelopmentSMS(service.now)
	developer, err := NewService(pool, mock, Config{Pepper: service.pepper, Now: service.now})
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.SendCode(context.Background(), "+6281234567890", "123456"); err != nil {
		t.Fatal(err)
	}
	disabled := NewHandler(developer, false)
	if result := invoke(disabled, "POST", "/dev/otp", `{"phone":"+6281234567890"}`, ""); result.Code != 404 {
		t.Errorf("Disabled development endpoint=%d,want404", result.Code)
	}
	enabled := NewHandler(developer, true)
	request := httptest.NewRequest("POST", "/dev/otp", strings.NewReader(`{"phone":"+6281234567890"}`))
	request.RemoteAddr = "203.0.113.10:1000"
	request.Header.Set("X-Forwarded-For", "127.0.0.1")
	result := httptest.NewRecorder()
	enabled.ServeHTTP(result, request)
	if result.Code != 403 {
		t.Errorf("Remote dev lookup=%d,want403", result.Code)
	}
	if result := invoke(enabled, "POST", "/dev/otp", `{"phone":"+6281234567890"}`, ""); result.Code != 200 {
		t.Errorf("Loopback dev lookup=%d,want200", result.Code)
	}
}

func TestHTTPLogoutInvalidatesToken(t *testing.T) {
	t.Parallel()
	service, sms, _, _ := fixture(t)
	challenge, code := challengeFor(t, service, sms, "device", "one")
	session, err := service.Verify(context.Background(), VerifyInput{ChallengeID: challenge.ID, Code: code, DeviceID: "device"})
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(service, false)
	if result := invoke(handler, "POST", "/v1/auth/logout", "", session.Token); result.Code != 204 {
		t.Errorf("HTTP logout=%d,want204", result.Code)
	}
	if result := invoke(handler, "GET", "/v1/session", "", session.Token); result.Code != 401 {
		t.Errorf("HTTP signed-out session=%d,want401", result.Code)
	}
}
