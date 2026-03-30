package mdf

import (
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"strings"
	"time"
)

// MDF4 data types
const (
	dtUIntLE  uint8 = 0
	dtUIntBE  uint8 = 1
	dtSIntLE  uint8 = 2
	dtSIntBE  uint8 = 3
	dtFloatLE uint8 = 4
	dtFloatBE uint8 = 5
)

// MDF4 channel types
const (
	cnTypeFixed       uint8 = 0
	cnTypeMaster      uint8 = 2
	cnTypeVirtMaster  uint8 = 3
)

type FileInfo struct {
	Version   string    `json:"version"`
	StartTime time.Time `json:"start_time"`
	Groups    int       `json:"groups"`
	Channels  []Channel `json:"channels"`
}

type Channel struct {
	Name     string  `json:"name"`
	Unit     string  `json:"unit"`
	Group    int     `json:"group"`
	Type     uint8   `json:"type"`
	DataType uint8   `json:"data_type"`
	BitCount uint32  `json:"bit_count"`
	MinVal   float64 `json:"min_val"`
	MaxVal   float64 `json:"max_val"`
}

type SignalData struct {
	Name   string    `json:"name"`
	Unit   string    `json:"unit"`
	Times  []float64 `json:"times"`
	Values []float64 `json:"values"`
}

// Internal representation of a data group
type dataGroup struct {
	cgOffset   int64
	dataOffset int64
	recIDSize  uint8
}

// Internal channel node
type channelNode struct {
	channel    Channel
	byteOffset uint32
	bitOffset  uint8
	ccOffset   int64 // channel conversion block
}

// Internal channel group
type channelGroup struct {
	dgIdx      int
	recID      uint64
	cycleCount uint64
	dataBytes  uint32
	invalBytes uint32
	channels   []channelNode
	masterCh   *channelNode
}

type Parser struct {
	f       *os.File
	version uint16
}

func Open(path string) (*Parser, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	p := &Parser{f: f}
	if err := p.checkID(); err != nil {
		f.Close()
		return nil, err
	}
	return p, nil
}

func (p *Parser) Close() {
	p.f.Close()
}

func (p *Parser) checkID() error {
	id := make([]byte, 64)
	if _, err := p.f.ReadAt(id, 0); err != nil {
		return fmt.Errorf("cannot read ID block: %w", err)
	}
	sig := strings.TrimRight(string(id[:8]), " \x00")
	if sig != "MDF" {
		return fmt.Errorf("not an MDF file (got %q)", sig)
	}
	binary.LittleEndian.Uint16(id[36:38]) // version number
	p.version = binary.LittleEndian.Uint16(id[36:38])
	if p.version < 400 {
		return fmt.Errorf("MDF version %d is not supported (only MDF4 is supported)", p.version)
	}
	return nil
}

// readBlock4 reads an MDF4 block at the given offset.
// Returns block ID string, links slice, and data bytes.
func (p *Parser) readBlock4(offset int64) (id string, links []int64, data []byte, err error) {
	if offset == 0 {
		return "", nil, nil, nil
	}
	hdr := make([]byte, 24)
	if _, err = p.f.ReadAt(hdr, offset); err != nil {
		return
	}
	id = string(hdr[:4])
	blockLen := binary.LittleEndian.Uint64(hdr[8:16])
	linkCount := binary.LittleEndian.Uint64(hdr[16:24])

	linksBuf := make([]byte, linkCount*8)
	if _, err = p.f.ReadAt(linksBuf, offset+24); err != nil {
		return
	}
	links = make([]int64, linkCount)
	for i := range links {
		links[i] = int64(binary.LittleEndian.Uint64(linksBuf[i*8:]))
	}

	dataStart := int64(24) + int64(linkCount*8)
	dataLen := int64(blockLen) - dataStart
	if dataLen > 0 {
		data = make([]byte, dataLen)
		_, err = p.f.ReadAt(data, offset+dataStart)
	}
	return
}

// readText reads a TX block (plain text) or MD block (XML) and returns the string content.
func (p *Parser) readText(offset int64) string {
	if offset == 0 {
		return ""
	}
	_, _, data, err := p.readBlock4(offset)
	if err != nil || len(data) == 0 {
		return ""
	}
	// null-terminated UTF-8
	end := len(data)
	for i, b := range data {
		if b == 0 {
			end = i
			break
		}
	}
	return string(data[:end])
}

// readHD reads the header block (at offset 64) and returns the start time.
func (p *Parser) readHD() (startTime time.Time, firstDG int64, err error) {
	_, links, data, err := p.readBlock4(64)
	if err != nil {
		return
	}
	if len(links) < 1 {
		err = fmt.Errorf("HD block has too few links")
		return
	}
	firstDG = links[0]
	if len(data) >= 8 {
		ns := binary.LittleEndian.Uint64(data[0:8])
		var tzOffset int16
		if len(data) >= 10 {
			tzOffset = int16(binary.LittleEndian.Uint16(data[8:10]))
		}
		startTime = time.Unix(0, int64(ns)).UTC().Add(time.Duration(tzOffset) * time.Minute)
	}
	return
}

// GetFileInfo parses the MDF file and returns metadata + channel list.
func (p *Parser) GetFileInfo() (*FileInfo, error) {
	major := p.version / 100
	minor := p.version % 100
	version := fmt.Sprintf("%d.%02d", major, minor)

	startTime, firstDG, err := p.readHD()
	if err != nil {
		return nil, fmt.Errorf("reading header: %w", err)
	}

	dgs, err := p.walkDG(firstDG)
	if err != nil {
		return nil, err
	}

	var allChannels []Channel
	for dgIdx, dg := range dgs {
		cgs, err := p.walkCG(dg.cgOffset, dgIdx, dg.recIDSize)
		if err != nil {
			continue
		}
		for _, cg := range cgs {
			for _, ch := range cg.channels {
				allChannels = append(allChannels, ch.channel)
			}
		}
	}

	return &FileInfo{
		Version:   version,
		StartTime: startTime,
		Groups:    len(dgs),
		Channels:  allChannels,
	}, nil
}

// walkDG walks the data group chain starting from offset.
func (p *Parser) walkDG(offset int64) ([]dataGroup, error) {
	var dgs []dataGroup
	for offset != 0 {
		_, links, data, err := p.readBlock4(offset)
		if err != nil {
			break
		}
		// DG links: [dg_dg_next, dg_cg_first, dg_data, dg_md_comment]
		var dgNext, cgFirst, dgData int64
		if len(links) >= 1 {
			dgNext = links[0]
		}
		if len(links) >= 2 {
			cgFirst = links[1]
		}
		if len(links) >= 3 {
			dgData = links[2]
		}
		var recIDSize uint8
		if len(data) >= 1 {
			recIDSize = data[0]
		}
		dgs = append(dgs, dataGroup{
			cgOffset:   cgFirst,
			dataOffset: dgData,
			recIDSize:  recIDSize,
		})
		offset = dgNext
	}
	return dgs, nil
}

// walkCG walks the channel group chain and parses each channel.
func (p *Parser) walkCG(offset int64, dgIdx int, recIDSize uint8) ([]channelGroup, error) {
	var cgs []channelGroup
	for offset != 0 {
		_, links, data, err := p.readBlock4(offset)
		if err != nil {
			break
		}
		// CG links: [cg_cg_next, cg_cn_first, cg_tx_acq_name, cg_si_acq_source, cg_sr_first, cg_md_comment]
		var cgNext, cnFirst int64
		if len(links) >= 1 {
			cgNext = links[0]
		}
		if len(links) >= 2 {
			cnFirst = links[1]
		}

		var cg channelGroup
		cg.dgIdx = dgIdx
		// data: record_id(8), cycle_count(8), flags(2), path_sep(2), reserved(4), data_bytes(4), inval_bytes(4)
		if len(data) >= 8 {
			cg.recID = binary.LittleEndian.Uint64(data[0:8])
		}
		if len(data) >= 16 {
			cg.cycleCount = binary.LittleEndian.Uint64(data[8:16])
		}
		if len(data) >= 28 {
			cg.dataBytes = binary.LittleEndian.Uint32(data[20:24])
			cg.invalBytes = binary.LittleEndian.Uint32(data[24:28])
		}

		cg.channels, cg.masterCh = p.walkCN(cnFirst, dgIdx)
		cgs = append(cgs, cg)
		offset = cgNext
	}
	return cgs, nil
}

// walkCN walks the channel chain and returns channel nodes.
func (p *Parser) walkCN(offset int64, dgIdx int) ([]channelNode, *channelNode) {
	var channels []channelNode
	var masterCh *channelNode
	for offset != 0 {
		_, links, data, err := p.readBlock4(offset)
		if err != nil {
			break
		}
		// CN links: [cn_cn_next, cn_composition, cn_tx_name, cn_si_source, cn_cc_conversion, cn_data, cn_md_unit, cn_md_comment, ...]
		var cnNext, txName, ccConv, mdUnit int64
		if len(links) >= 1 {
			cnNext = links[0]
		}
		if len(links) >= 3 {
			txName = links[2]
		}
		if len(links) >= 5 {
			ccConv = links[4]
		}
		if len(links) >= 7 {
			mdUnit = links[6]
		}

		name := p.readText(txName)
		unit := p.readText(mdUnit)

		// CN data: cn_type(1), cn_sync_type(1), cn_data_type(1), cn_bit_offset(1), cn_byte_offset(4), cn_bit_count(4), cn_flags(4), cn_inval_bit_pos(4), cn_precision(1), cn_reserved(1), cn_attachment_count(2), cn_val_range_min(8), cn_val_range_max(8), ...
		var cnType, cnDataType, bitOffset uint8
		var byteOffset, bitCount uint32
		var minVal, maxVal float64

		if len(data) >= 1 {
			cnType = data[0]
		}
		if len(data) >= 3 {
			cnDataType = data[2]
		}
		if len(data) >= 4 {
			bitOffset = data[3]
		}
		if len(data) >= 8 {
			byteOffset = binary.LittleEndian.Uint32(data[4:8])
		}
		if len(data) >= 12 {
			bitCount = binary.LittleEndian.Uint32(data[8:12])
		}
		if len(data) >= 36 {
			minVal = math.Float64frombits(binary.LittleEndian.Uint64(data[20:28]))
			maxVal = math.Float64frombits(binary.LittleEndian.Uint64(data[28:36]))
		}

		ch := channelNode{
			channel: Channel{
				Name:     name,
				Unit:     unit,
				Group:    dgIdx,
				Type:     cnType,
				DataType: cnDataType,
				BitCount: bitCount,
				MinVal:   minVal,
				MaxVal:   maxVal,
			},
			byteOffset: byteOffset,
			bitOffset:  bitOffset,
			ccOffset:   ccConv,
		}

		channels = append(channels, ch)
		if cnType == cnTypeMaster || cnType == cnTypeVirtMaster {
			c := channels[len(channels)-1]
			masterCh = &c
		}

		offset = cnNext
	}
	return channels, masterCh
}

// GetChannelData reads the signal values for the given channel name in the given group.
func (p *Parser) GetChannelData(groupIdx int, channelName string) (*SignalData, error) {
	_, firstDG, err := p.readHD()
	if err != nil {
		return nil, err
	}

	dgs, err := p.walkDG(firstDG)
	if err != nil || groupIdx >= len(dgs) {
		return nil, fmt.Errorf("group %d not found", groupIdx)
	}

	dg := dgs[groupIdx]
	cgs, err := p.walkCG(dg.cgOffset, groupIdx, dg.recIDSize)
	if err != nil {
		return nil, err
	}

	for cgIdx, cg := range cgs {
		for _, ch := range cg.channels {
			if ch.channel.Name != channelName {
				continue
			}
			return p.readChannelData(dg, cg, ch, cgs[cgIdx])
		}
	}
	return nil, fmt.Errorf("channel %q not found in group %d", channelName, groupIdx)
}

func (p *Parser) readChannelData(dg dataGroup, cg channelGroup, ch channelNode, cgFull channelGroup) (*SignalData, error) {
	if cg.cycleCount == 0 {
		return &SignalData{Name: ch.channel.Name, Unit: ch.channel.Unit}, nil
	}

	rawData, err := p.readDataBlock(dg.dataOffset)
	if err != nil {
		return nil, err
	}

	recSize := int(cg.dataBytes) + int(cg.invalBytes) + int(dg.recIDSize)
	if recSize == 0 || len(rawData) == 0 {
		return &SignalData{Name: ch.channel.Name, Unit: ch.channel.Unit}, nil
	}

	nRecs := len(rawData) / recSize
	if nRecs == 0 {
		return &SignalData{Name: ch.channel.Name, Unit: ch.channel.Unit}, nil
	}

	values := make([]float64, 0, nRecs)
	times := make([]float64, 0, nRecs)

	// Find master channel for time
	var masterCh *channelNode
	for i := range cgFull.channels {
		ct := cgFull.channels[i].channel.Type
		if ct == cnTypeMaster || ct == cnTypeVirtMaster {
			masterCh = &cgFull.channels[i]
			break
		}
	}

	ccFactor, ccOffset := p.readCC(ch.ccOffset)

	for i := 0; i < nRecs; i++ {
		recStart := i * recSize
		recEnd := recStart + recSize
		if recEnd > len(rawData) {
			break
		}
		rec := rawData[recStart:recEnd]
		dataStart := int(dg.recIDSize)
		if dataStart >= len(rec) {
			continue
		}
		recData := rec[dataStart:]

		v := extractValue(recData, ch.byteOffset, ch.bitOffset, ch.channel.BitCount, ch.channel.DataType)
		v = v*ccFactor + ccOffset
		values = append(values, v)

		if masterCh != nil {
			t := extractValue(recData, masterCh.byteOffset, masterCh.bitOffset, masterCh.channel.BitCount, masterCh.channel.DataType)
			mf, mo := p.readCC(masterCh.ccOffset)
			t = t*mf + mo
			times = append(times, t)
		} else {
			times = append(times, float64(i))
		}
	}

	return &SignalData{
		Name:   ch.channel.Name,
		Unit:   ch.channel.Unit,
		Times:  times,
		Values: values,
	}, nil
}

// readCC reads a channel conversion block and returns (factor, offset) for linear conversion.
func (p *Parser) readCC(offset int64) (factor, off float64) {
	factor = 1.0
	if offset == 0 {
		return
	}
	_, _, data, err := p.readBlock4(offset)
	if err != nil || len(data) < 2 {
		return
	}
	ccType := data[1] // cc_type
	// Type 1 = linear: val = a + b * raw  (a=offset, b=factor)
	if ccType == 1 && len(data) >= 18 {
		off = math.Float64frombits(binary.LittleEndian.Uint64(data[2:10]))
		factor = math.Float64frombits(binary.LittleEndian.Uint64(data[10:18]))
	}
	return
}

// readDataBlock reads raw bytes from a DT (or DL) block at the given offset.
func (p *Parser) readDataBlock(offset int64) ([]byte, error) {
	if offset == 0 {
		return nil, nil
	}
	id, links, data, err := p.readBlock4(offset)
	if err != nil {
		return nil, err
	}
	switch id {
	case "##DT", "##RD":
		return data, nil
	case "##DL": // Data List block - concatenate referenced data blocks
		var result []byte
		for _, lnk := range links {
			if lnk == 0 {
				continue
			}
			chunk, err := p.readDataBlock(lnk)
			if err == nil {
				result = append(result, chunk...)
			}
		}
		_ = data
		return result, nil
	}
	return data, nil
}

// extractValue reads a numeric value from a record byte slice.
func extractValue(rec []byte, byteOff uint32, bitOff uint8, bitCount uint32, dataType uint8) float64 {
	start := int(byteOff)
	if start >= len(rec) {
		return 0
	}
	d := rec[start:]

	switch dataType {
	case dtUIntLE:
		switch bitCount {
		case 8:
			if len(d) >= 1 {
				return float64(d[0])
			}
		case 16:
			if len(d) >= 2 {
				return float64(binary.LittleEndian.Uint16(d[:2]))
			}
		case 32:
			if len(d) >= 4 {
				return float64(binary.LittleEndian.Uint32(d[:4]))
			}
		case 64:
			if len(d) >= 8 {
				return float64(binary.LittleEndian.Uint64(d[:8]))
			}
		}
	case dtUIntBE:
		switch bitCount {
		case 8:
			if len(d) >= 1 {
				return float64(d[0])
			}
		case 16:
			if len(d) >= 2 {
				return float64(binary.BigEndian.Uint16(d[:2]))
			}
		case 32:
			if len(d) >= 4 {
				return float64(binary.BigEndian.Uint32(d[:4]))
			}
		case 64:
			if len(d) >= 8 {
				return float64(binary.BigEndian.Uint64(d[:8]))
			}
		}
	case dtSIntLE:
		switch bitCount {
		case 8:
			if len(d) >= 1 {
				return float64(int8(d[0]))
			}
		case 16:
			if len(d) >= 2 {
				return float64(int16(binary.LittleEndian.Uint16(d[:2])))
			}
		case 32:
			if len(d) >= 4 {
				return float64(int32(binary.LittleEndian.Uint32(d[:4])))
			}
		case 64:
			if len(d) >= 8 {
				return float64(int64(binary.LittleEndian.Uint64(d[:8])))
			}
		}
	case dtSIntBE:
		switch bitCount {
		case 8:
			if len(d) >= 1 {
				return float64(int8(d[0]))
			}
		case 16:
			if len(d) >= 2 {
				return float64(int16(binary.BigEndian.Uint16(d[:2])))
			}
		case 32:
			if len(d) >= 4 {
				return float64(int32(binary.BigEndian.Uint32(d[:4])))
			}
		case 64:
			if len(d) >= 8 {
				return float64(int64(binary.BigEndian.Uint64(d[:8])))
			}
		}
	case dtFloatLE:
		switch bitCount {
		case 32:
			if len(d) >= 4 {
				return float64(math.Float32frombits(binary.LittleEndian.Uint32(d[:4])))
			}
		case 64:
			if len(d) >= 8 {
				return math.Float64frombits(binary.LittleEndian.Uint64(d[:8]))
			}
		}
	case dtFloatBE:
		switch bitCount {
		case 32:
			if len(d) >= 4 {
				return float64(math.Float32frombits(binary.BigEndian.Uint32(d[:4])))
			}
		case 64:
			if len(d) >= 8 {
				return math.Float64frombits(binary.BigEndian.Uint64(d[:8]))
			}
		}
	}

	// Fallback: handle sub-byte or arbitrary bit widths
	if bitCount == 0 || bitCount > 64 {
		return 0
	}
	byteCount := (int(bitCount) + 7) / 8
	if len(d) < byteCount {
		return 0
	}
	var raw uint64
	for i := 0; i < byteCount; i++ {
		raw |= uint64(d[i]) << (uint(i) * 8)
	}
	raw >>= bitOff
	mask := uint64((1 << bitCount) - 1)
	if bitCount == 64 {
		mask = ^uint64(0)
	}
	raw &= mask
	return float64(raw)
}
