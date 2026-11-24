package web

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"appshome/internal/builder"
	"appshome/internal/registry"
)

const (
	llmMaxSystem = 24 << 10
	llmMaxPrompt = 32 << 10
	llmMaxTokens = 32768
	llmWindow    = 10 * time.Minute
	llmPerWindow = 20
	llmTimeout   = 180 * time.Second
)

// llmLimiter allows each app a fixed number of prompts per sliding window,
// so a busy page (or a stuck loop) can't run up the model bill.
type llmLimiter struct {
	mu    sync.Mutex
	calls map[string][]time.Time
	now   func() time.Time
}

func (l *llmLimiter) allow(app string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.calls == nil {
		l.calls = map[string][]time.Time{}
	}
	now := time.Now()
	if l.now != nil {
		now = l.now()
	}
	kept := l.calls[app][:0]
	for _, t := range l.calls[app] {
		if now.Sub(t) < llmWindow {
			kept = append(kept, t)
		}
	}
	if len(kept) >= llmPerWindow {
		l.calls[app] = kept
		return false
	}
	l.calls[app] = append(kept, now)
	return true
}

type llmRequest struct {
	System      string   `json:"system"`
	Prompt      string   `json:"prompt"`
	MaxTokens   int32    `json:"maxTokens"`
	Temperature *float32 `json:"temperature"`
}

// llmAsk answers one prompt with JSON for apps that declare the llm
// capability. Apps send their own instructions; the reply is the model's
// JSON text, which the app must validate before using.
func (s *Server) llmAsk(w http.ResponseWriter, r *http.Request) {
	a, ok := s.callingApp(w, r)
	if !ok {
		return
	}
	if !a.Has(registry.CapLLM) {
		writeErr(w, http.StatusForbidden, "this app doesn't have the llm capability")
		return
	}
	var req llmRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, llmMaxSystem+llmMaxPrompt+1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "send JSON: {system, prompt}")
		return
	}
	req.Prompt = strings.TrimSpace(req.Prompt)
	switch {
	case req.Prompt == "":
		writeErr(w, http.StatusBadRequest, "prompt is empty")
		return
	case len(req.Prompt) > llmMaxPrompt:
		writeErr(w, http.StatusRequestEntityTooLarge, "prompt is limited to 32 KB")
		return
	case req.MaxTokens < 0 || req.MaxTokens > llmMaxTokens:
		writeErr(w, http.StatusBadRequest, "maxTokens is 1 to 32768")
		return
	case req.Temperature != nil && (*req.Temperature < 0 || *req.Temperature > 1.5):
		writeErr(w, http.StatusBadRequest, "temperature is 0 to 1.5")
		return
	case len(req.System) > llmMaxSystem:
		writeErr(w, http.StatusRequestEntityTooLarge, "system instructions are limited to 24 KB")
		return
	}
	if !s.llmLimit.allow(a.Name) {
		writeErr(w, http.StatusTooManyRequests, "too many prompts; try again in a few minutes")
		return
	}
	if s.builder == nil {
		writeErr(w, http.StatusServiceUnavailable, "no model is configured on this host")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), llmTimeout)
	defer cancel()
	text, err := s.builder.CompleteWith(ctx, req.System, req.Prompt, builder.Options{MaxTokens: req.MaxTokens, Temperature: req.Temperature})
	if err != nil {
		s.log.Printf("llm %s: %v", a.Name, err)
		writeErr(w, http.StatusBadGateway, "the model call failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"text": text, "model": s.builder.Model()})
}
