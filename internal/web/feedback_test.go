package web

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// A 1x1 PNG.
var tinyPNG, _ = base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")

func sendFeedback(s *Server, app, host, body string, header map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/_hearth/feedback", strings.NewReader(body))
	r.Host = host
	if app != "" {
		r.Header.Set("X-Apps-Home-App", app)
	}
	for k, v := range header {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}

func TestFeedbackFromAnAppAndTheHomePage(t *testing.T) {
	s, cfg := hearthServer(t)
	w := sendFeedback(s, "notes", cfg.AppHost("notes"), `{"message":"  The save button is hidden on my phone ","name":"Amma","page":"https://notes.apps.home/x","theme":"dark","viewport":"390×844"}`, nil)
	if w.Code != http.StatusCreated {
		t.Fatalf("app feedback: %d %s", w.Code, w.Body)
	}
	if c := w.Result().Cookies(); len(c) != 1 || c[0].Name != nameCookie || !c[0].HttpOnly {
		t.Fatalf("the name is remembered for the next form: %+v", c)
	}
	if w := sendFeedback(s, "", cfg.Domain, `{"message":"Can we have a recipes app?","page":"javascript:alert(1)"}`, nil); w.Code != http.StatusCreated {
		t.Fatalf("home feedback: %d %s", w.Code, w.Body)
	}
	list := s.feedback().newest(false)
	if len(list) != 2 || list[0].App != homeApp || list[0].AppTitle != "Home page" || list[1].AppTitle != "Notes" {
		t.Fatalf("stored: %+v", list)
	}
	if list[1].Message != "The save button is hidden on my phone" || list[1].Name != "Amma" || list[1].Theme != "dark" {
		t.Fatalf("fields: %+v", list[1])
	}
	if list[0].Page != "" {
		t.Errorf("only web addresses are kept as the page: %q", list[0].Page)
	}
	if s.feedback().unread() != 2 {
		t.Errorf("both are unread")
	}
	if n := s.feedback().names(); len(n) != 1 || n[0] != "Amma" {
		t.Errorf("names: %v", n)
	}
}

func TestFeedbackRejects(t *testing.T) {
	s, cfg := hearthServer(t)
	cases := []struct {
		name, app, host, body string
		header                map[string]string
		code                  int
	}{
		{"empty message", "notes", cfg.AppHost("notes"), `{"message":"   "}`, nil, 400},
		{"another site", "notes", cfg.AppHost("notes"), `{"message":"hi"}`, map[string]string{"Sec-Fetch-Site": "cross-site"}, 403},
		{"another app's origin", "notes", cfg.AppHost("notes"), `{"message":"hi"}`, map[string]string{"Origin": "https://evil.example"}, 403},
		{"unknown app", "ghost", cfg.AppHost("ghost"), `{"message":"hi"}`, nil, 404},
		{"unknown host", "", "elsewhere.test", `{"message":"hi"}`, nil, 404},
		{"not a picture", "notes", cfg.AppHost("notes"), `{"message":"hi","image":"data:image/png;base64,` + base64.StdEncoding.EncodeToString([]byte("<html>")) + `"}`, nil, 400},
		{"bad data url", "notes", cfg.AppHost("notes"), `{"message":"hi","image":"https://x/y.png"}`, nil, 400},
	}
	for _, c := range cases {
		if w := sendFeedback(s, c.app, c.host, c.body, c.header); w.Code != c.code {
			t.Errorf("%s: got %d want %d (%s)", c.name, w.Code, c.code, w.Body)
		}
	}
	if n := len(s.feedback().newest(false)); n != 0 {
		t.Fatalf("nothing should be stored, got %d", n)
	}
}

func TestFeedbackPictureAndInbox(t *testing.T) {
	s, cfg := hearthServer(t)
	img := "data:image/png;base64," + base64.StdEncoding.EncodeToString(tinyPNG)
	if w := sendFeedback(s, "notes", cfg.AppHost("notes"), `{"message":"see picture","image":"`+img+`"}`, nil); w.Code != 201 {
		t.Fatalf("send: %d %s", w.Code, w.Body)
	}
	fb := s.feedback().newest(false)[0]
	if !strings.HasSuffix(fb.Image, ".png") {
		t.Fatalf("image name: %q", fb.Image)
	}
	path := s.feedback().imagePath(fb.Image)
	if st, err := os.Stat(path); err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("picture on disk: %v %v", st, err)
	}

	w := httptest.NewRecorder()
	s.feedbackInbox(w, httptest.NewRequest("GET", "/feedback", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "see picture") || !strings.Contains(w.Body.String(), `data-hearth-feedback="off"`) {
		t.Fatalf("inbox: %d %.300s", w.Code, w.Body)
	}
	if s.feedback().unread() != 0 {
		t.Error("opening the inbox marks everything seen")
	}

	r := httptest.NewRequest("GET", "/feedback/images/"+fb.Image, nil)
	r.SetPathValue("file", fb.Image)
	w = httptest.NewRecorder()
	s.feedbackImage(w, r)
	if w.Code != 200 || w.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("image: %d %s", w.Code, w.Header().Get("Content-Type"))
	}
	r = httptest.NewRequest("GET", "/feedback/images/..%2Fconfig.json", nil)
	r.SetPathValue("file", "../config.json")
	w = httptest.NewRecorder()
	s.feedbackImage(w, r)
	if w.Code != 404 {
		t.Fatalf("only stored pictures are served: %d", w.Code)
	}

	change := func(action string) int {
		r := httptest.NewRequest("POST", "/feedback/"+fb.ID+"/"+action, nil)
		r.SetPathValue("id", fb.ID)
		r.SetPathValue("action", action)
		w := httptest.NewRecorder()
		s.feedbackChange(w, r)
		return w.Code
	}
	if change("done") != http.StatusSeeOther || !s.feedback().newest(false)[0].Done {
		t.Fatal("mark done")
	}
	if change("explode") != 404 {
		t.Fatal("unknown actions are refused")
	}
	if change("delete") != http.StatusSeeOther || len(s.feedback().newest(false)) != 0 {
		t.Fatal("delete")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("deleting feedback deletes its picture")
	}
}

func TestFeedbackIsRateLimited(t *testing.T) {
	s, cfg := hearthServer(t)
	codes := map[int]int{}
	for i := 0; i < feedbackPerWindow+3; i++ {
		codes[sendFeedback(s, "notes", cfg.AppHost("notes"), `{"message":"again"}`, nil).Code]++
	}
	if codes[201] != feedbackPerWindow || codes[429] != 3 {
		t.Fatalf("codes: %v", codes)
	}
}

func TestFeedbackMe(t *testing.T) {
	s, cfg := hearthServer(t)
	sendFeedback(s, "notes", cfg.AppHost("notes"), `{"message":"a","name":"Appa"}`, nil)
	r := httptest.NewRequest("GET", "/_hearth/feedback/me", nil)
	r.Host = cfg.AppHost("notes")
	r.Header.Set("X-Apps-Home-App", "notes")
	r.AddCookie(&http.Cookie{Name: nameCookie, Value: "Krishna%20K"})
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"name": "Krishna K"`) || !strings.Contains(w.Body.String(), `"Appa"`) {
		t.Fatalf("me: %d %s", w.Code, w.Body)
	}
}
