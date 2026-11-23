// Package cast speaks just enough of the Google Cast v2 protocol to find
// speakers and TVs on the LAN and play audio on them with the Default Media
// Receiver: discovery over mDNS, then length-prefixed protobuf frames over TLS.
package cast

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

// Message is the CastMessage protobuf. Every payload we use is a JSON string.
type Message struct {
	Source, Dest, Namespace, Payload string
}

const maxFrame = 64 << 10

func appendVarint(b []byte, v uint64) []byte {
	for v >= 0x80 {
		b = append(b, byte(v)|0x80)
		v >>= 7
	}
	return append(b, byte(v))
}

func appendString(b []byte, field int, s string) []byte {
	b = appendVarint(b, uint64(field<<3|2))
	b = appendVarint(b, uint64(len(s)))
	return append(b, s...)
}

func (m Message) marshal() []byte {
	b := []byte{0x08, 0x00} // protocol_version = CASTV2_1_0
	b = appendString(b, 2, m.Source)
	b = appendString(b, 3, m.Dest)
	b = appendString(b, 4, m.Namespace)
	b = append(b, 0x28, 0x00) // payload_type = STRING
	return appendString(b, 6, m.Payload)
}

func readVarint(b []byte) (uint64, int, error) {
	var v uint64
	for i := 0; i < len(b) && i < 10; i++ {
		v |= uint64(b[i]&0x7f) << (7 * i)
		if b[i] < 0x80 {
			return v, i + 1, nil
		}
	}
	return 0, 0, errors.New("cast: bad varint")
}

func unmarshal(b []byte) (Message, error) {
	var m Message
	for len(b) > 0 {
		key, n, err := readVarint(b)
		if err != nil {
			return m, err
		}
		b = b[n:]
		field, wire := int(key>>3), key&7
		switch wire {
		case 0:
			_, n, err := readVarint(b)
			if err != nil {
				return m, err
			}
			b = b[n:]
		case 2:
			l, n, err := readVarint(b)
			if err != nil || uint64(len(b)-n) < l {
				return m, errors.New("cast: truncated field")
			}
			s := string(b[n : n+int(l)])
			b = b[n+int(l):]
			switch field {
			case 2:
				m.Source = s
			case 3:
				m.Dest = s
			case 4:
				m.Namespace = s
			case 6:
				m.Payload = s
			}
		default:
			return m, fmt.Errorf("cast: unexpected wire type %d", wire)
		}
	}
	return m, nil
}

// WriteFrame sends one length-prefixed CastMessage.
func WriteFrame(w io.Writer, m Message) error {
	body := m.marshal()
	frame := make([]byte, 4, 4+len(body))
	binary.BigEndian.PutUint32(frame, uint32(len(body)))
	_, err := w.Write(append(frame, body...))
	return err
}

// ReadFrame reads one length-prefixed CastMessage.
func ReadFrame(r io.Reader) (Message, error) {
	var hdr [4]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return Message{}, err
	}
	n := binary.BigEndian.Uint32(hdr[:])
	if n > maxFrame {
		return Message{}, fmt.Errorf("cast: %d-byte frame", n)
	}
	body := make([]byte, n)
	if _, err := io.ReadFull(r, body); err != nil {
		return Message{}, err
	}
	return unmarshal(body)
}
