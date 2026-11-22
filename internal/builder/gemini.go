package builder

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"

	"google.golang.org/genai"

	"appshome/internal/config"
)

type Turn struct {
	Role string // "user" or "model"
	Text string
}

// Generator returns the model's raw JSON reply for a conversation.
type Generator interface {
	Generate(ctx context.Context, system string, turns []Turn) (string, error)
}

// Completer answers a single prompt with JSON text.
type Completer interface {
	Complete(ctx context.Context, system, prompt string) (string, error)
}

// ResolveProject finds the GCP project: config, then GOOGLE_CLOUD_PROJECT,
// then the active gcloud configuration.
func ResolveProject(cfg config.Config) string {
	if cfg.GCPProject != "" {
		return cfg.GCPProject
	}
	if p := os.Getenv("GOOGLE_CLOUD_PROJECT"); p != "" {
		return p
	}
	out, err := exec.Command("gcloud", "config", "get-value", "project").Output()
	if err != nil {
		return ""
	}
	p := strings.TrimSpace(string(out))
	if p == "(unset)" {
		return ""
	}
	return p
}

type gemini struct {
	client *genai.Client
	model  string
}

// NewGemini uses Vertex AI with Application Default Credentials
// (`gcloud auth application-default login` on the host).
func NewGemini(ctx context.Context, cfg config.Config) (Generator, error) {
	project := ResolveProject(cfg)
	if project == "" {
		return nil, errors.New("no GCP project: set gcp_project in config.json or run `gcloud config set project ID`")
	}
	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		Backend:  genai.BackendVertexAI,
		Project:  project,
		Location: cfg.GCPLocation,
	})
	if err != nil {
		return nil, err
	}
	return &gemini{client: client, model: cfg.GeminiModel}, nil
}

var outputSchema = &genai.Schema{
	Type: genai.TypeObject,
	Properties: map[string]*genai.Schema{
		"title":       {Type: genai.TypeString, Description: "Short app title, at most 60 characters"},
		"description": {Type: genai.TypeString, Description: "One sentence shown on the portal card"},
		"tags":        {Type: genai.TypeArray, Items: &genai.Schema{Type: genai.TypeString}, Description: "1-4 lowercase tags"},
		"notes":       {Type: genai.TypeString, Description: "One or two sentences on what was built or changed"},
		"files": {
			Type: genai.TypeArray,
			Items: &genai.Schema{
				Type: genai.TypeObject,
				Properties: map[string]*genai.Schema{
					"path":    {Type: genai.TypeString, Description: "Path relative to the app folder, e.g. index.html or js/app.js"},
					"content": {Type: genai.TypeString, Description: "Full file contents"},
				},
				Required: []string{"path", "content"},
			},
		},
	},
	Required: []string{"title", "description", "files"},
}

// Complete answers one prompt with JSON, for apps with the llm capability.
func (g *gemini) Complete(ctx context.Context, system, prompt string) (string, error) {
	resp, err := g.client.Models.GenerateContent(ctx, g.model, genai.Text(prompt), &genai.GenerateContentConfig{
		SystemInstruction: genai.NewContentFromText(system, genai.RoleUser),
		ResponseMIMEType:  "application/json",
		Temperature:       genai.Ptr[float32](0.3),
		MaxOutputTokens:   8192,
	})
	if err != nil {
		return "", err
	}
	text := resp.Text()
	if text == "" {
		return "", errors.New("the model returned an empty response")
	}
	return text, nil
}

func (g *gemini) Generate(ctx context.Context, system string, turns []Turn) (string, error) {
	var contents []*genai.Content
	for _, t := range turns {
		var role genai.Role = genai.RoleUser
		if t.Role == "model" {
			role = genai.RoleModel
		}
		contents = append(contents, genai.NewContentFromText(t.Text, role))
	}
	resp, err := g.client.Models.GenerateContent(ctx, g.model, contents, &genai.GenerateContentConfig{
		SystemInstruction: genai.NewContentFromText(system, genai.RoleUser),
		ResponseMIMEType:  "application/json",
		ResponseSchema:    outputSchema,
		Temperature:       genai.Ptr[float32](0.4),
	})
	if err != nil {
		return "", err
	}
	text := resp.Text()
	if text == "" {
		return "", errors.New("the model returned an empty response")
	}
	return text, nil
}
