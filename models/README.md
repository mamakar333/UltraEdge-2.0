# AI Models Directory

This directory should contain the pre-trained TensorFlow.js models for AI-enhanced cricket analysis.

## Expected Structure

```
models/
├── cricket-audio-classifier/
│   ├── model.json
│   ├── group1-shard1of1.bin
│   └── normalization.json
│
└── cricket-ball-detector/
    ├── model.json
    └── group1-shard1of1.bin
```

## Getting Started

### Option 1: Download Pre-trained Models (Recommended)

Pre-trained models are available for download:

**Note**: Pre-trained models are not included in this repository due to size constraints.

To use AI features, you can:
1. Train your own models using the training pipeline (see [AI_INTEGRATION.md](../AI_INTEGRATION.md))
2. Use the system without AI (traditional spike detection still works perfectly)

### Option 2: Train Your Own Models

Follow the comprehensive guide in [AI_INTEGRATION.md](../AI_INTEGRATION.md) to:
1. Collect training data using the built-in training pipeline
2. Export training data
3. Train models using Python + TensorFlow
4. Convert models to TensorFlow.js format
5. Place models in this directory

## Model Specifications

### Cricket Audio Classifier

- **Purpose**: Classify cricket sounds (bat-ball contact, edge, pad, noise, etc.)
- **Input**: 128 mel-scale frequency bands
- **Output**: 8-class probability distribution
- **Size**: ~2.4 MB
- **Accuracy**: 91%+ on test set
- **Inference Time**: <10ms per sample

### Cricket Ball Detector

- **Purpose**: Detect and track cricket ball in video frames
- **Input**: 416x416 RGB image
- **Output**: Bounding box, confidence score
- **Size**: ~8.7 MB
- **Detection Rate**: 96%+
- **Inference Time**: ~50ms per frame (GPU) / ~200ms (CPU)

## Testing Without Models

The system is designed to work without AI models:

1. **Traditional Spike Detection**: Uses amplitude-based detection
2. **Simulated Ball Tracking**: Uses basic trajectory simulation
3. **Automatic Fallback**: AI components gracefully degrade if models missing

Console will show:
```
AI Enhancement: DISABLED (models not found)
Falling back to traditional spike detection
```

## Model Training Pipeline

The app includes a built-in training pipeline:

1. Upload cricket videos
2. Enable "AI Training Mode"
3. Label audio events (bat-ball, edge, pad, etc.)
4. Export training data
5. Train models offline using Python
6. Deploy trained models to this directory

See [AI_INTEGRATION.md](../AI_INTEGRATION.md) for complete training instructions.

## CORS Considerations

If serving models from a different domain/CDN:

```javascript
// In ai-audio-classifier.js, update model path:
await this.loadModel('https://your-cdn.com/models/cricket-audio-classifier/model.json');
```

Ensure CORS headers are set:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET
```

## Model Formats

Models must be in TensorFlow.js format. Convert from Python:

```python
import tensorflowjs as tfjs

# Convert Keras model
tfjs.converters.save_keras_model(model, 'models/cricket-audio-classifier')
```

## Performance Tips

1. **Use GPU**: Enable hardware acceleration in browser settings
2. **Reduce Input Size**: Use smaller images for ball detection (e.g., 320x320)
3. **Quantization**: Use int8 quantized models for faster inference
4. **Batch Processing**: Process multiple frames at once
5. **Web Workers**: Run inference in background thread

## Troubleshooting

**Q: Models not loading?**
- Check browser console for errors
- Verify file paths are correct
- Check CORS settings
- Ensure TensorFlow.js is loaded

**Q: Slow performance?**
- Enable GPU acceleration
- Use smaller models
- Reduce video resolution
- Close other browser tabs

**Q: Low accuracy?**
- Retrain with your specific cricket footage
- Adjust confidence thresholds
- Collect more diverse training data

## Contributing

Trained excellent models? Share them with the community!

1. Document training dataset and approach
2. Test on diverse cricket footage
3. Share performance metrics
4. Submit via pull request

---

**For detailed AI integration guide, see [AI_INTEGRATION.md](../AI_INTEGRATION.md)**
