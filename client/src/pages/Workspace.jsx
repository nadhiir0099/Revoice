import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function Workspace() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Steps: 'upload' -> 'transcribing' -> 'editing' -> 'options' -> 'processing' -> 'result'
  const [step, setStep] = useState('upload');
  const [creations, setCreations] = useState([]);
  const [activeCreationId, setActiveCreationId] = useState(null);

  // Creation State
  const [file, setFile] = useState(null);
  const [mediaUrl, setMediaUrl] = useState(null);
  const [filename, setFilename] = useState(null);
  const [segments, setSegments] = useState([]);
  const [sourceMode, setSourceMode] = useState('original');
  const [language, setLanguage] = useState('original');
  const [dubLanguage, setDubLanguage] = useState('original');
  const [resultUrl, setResultUrl] = useState(null);
  const [captionUrl, setCaptionUrl] = useState(null);
  const [useCloning, setUseCloning] = useState(false);

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [creationToDelete, setCreationToDelete] = useState(null);
  const [activeMenuId, setActiveMenuId] = useState(null);

  const [showRenameModal, setShowRenameModal] = useState(false);
  const [creationToRename, setCreationToRename] = useState(null);
  const [newTitle, setNewTitle] = useState("");

  const fileInputRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Fetch Creations on mount
  useEffect(() => {
    fetchCreations();

    // Global click listener to close context menus
    const handleClickOutside = () => setActiveMenuId(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  const fetchCreations = async () => {
    try {
      const res = await axios.get('/api/creations');
      setCreations(res.data.creations);
    } catch (err) {
      console.error("Failed to fetch creations", err);
    }
  };

  const handleNewVideo = () => {
    setActiveCreationId(null);
    clearCreationState();
    setStep('upload');
  };

  const clearCreationState = () => {
    setFile(null);
    setMediaUrl(null);
    setFilename(null);
    setSegments([]);
    setSourceMode('original');
    setLanguage('original');
    setDubLanguage('original');
    setResultUrl(null);
    setCaptionUrl(null);
    setUseCloning(false);
    setError(null);
  };

  const loadCreation = async (id) => {
    try {
      setIsProcessing(true);
      const res = await axios.get(`/api/creations/${id}`);
      const { creation, media, segments } = res.data;

      setActiveCreationId(creation._id);

      const statusSteps = {
        'uploading': 'upload',
        'transcribed': 'editing',
        'edited': 'options',
        'processing': 'processing',
        'dubbed': 'result'
      };
      setStep(statusSteps[creation.status] || 'upload');

      setFilename(creation.originalFilename);
      setSegments(segments);
      setSourceMode(creation.sourceDialect === 'tunisian_normalized' ? 'normalized_arabic' : 'original');
      setLanguage(creation.targetLanguage || 'original');
      setDubLanguage(creation.targetLanguage || 'original');
      setUseCloning(creation.useCloning || false);

      const originalVideo = media.find(m => m.type === 'original_video');
      const dubbedVideo = media.find(m => m.type === 'dubbed_video');

      if (dubbedVideo) {
        setResultUrl(`${import.meta.env.VITE_API_URL || 'http://localhost:3005'}${dubbedVideo.url}`);
      } else {
        setResultUrl(null);
      }

      if (originalVideo) {
        setMediaUrl(`${import.meta.env.VITE_API_URL || 'http://localhost:3005'}${originalVideo.url}`);
      } else if (creation.originalFilename) {
        setMediaUrl(`${import.meta.env.VITE_API_URL || 'http://localhost:3005'}/uploads/${creation.originalFilename}`);
      }
    } catch (err) {
      console.error("Failed to load creation", err);
      setError("Failed to load project details.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`/api/creations/${id}`);
      fetchCreations();
      if (activeCreationId === id) {
        handleNewVideo();
      }
    } catch (err) {
      console.error("Failed to delete creation", err);
      setError("Failed to delete project.");
    } finally {
      setShowDeleteConfirm(false);
      setCreationToDelete(null);
    }
  };

  const handleRename = async () => {
    if (!creationToRename || !newTitle.trim()) return;
    try {
      await axios.patch(`/api/creations/${creationToRename._id}`, {
        title: newTitle
      });
      fetchCreations();
      // If we renamed the active creation, we might want to update the displayed title if it's shown elsewhere, 
      // but fetchCreations updates the list which is enough for the sidebar.
    } catch (err) {
      console.error("Failed to rename creation", err);
      setError("Failed to rename project.");
    } finally {
      setShowRenameModal(false);
      setCreationToRename(null);
      setNewTitle("");
    }
  };

  // --- Handlers ---
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      const url = URL.createObjectURL(selectedFile);
      setFile(selectedFile);
      setMediaUrl(url);
    }
  };

  const handleInitTranscription = async () => {
    if (!file) return;
    setIsProcessing(true);
    setStep('transcribing');
    setError(null);

    const formData = new FormData();
    formData.append('audio', file);
    const url = `/api/init-transcription?languageMode=${sourceMode}`;

    try {
      const res = await axios.post(url, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setActiveCreationId(res.data.creationId);
      setFilename(res.data.filename);
      setSegments(res.data.segments);
      setStep('editing');
      fetchCreations();
    } catch (err) {
      console.error(err);
      setError('Failed to transcribe. Please try again.');
      setStep('upload');
    } finally {
      setIsProcessing(false);
    }
  };

  const saveSegments = async () => {
    if (!activeCreationId) return;
    try {
      await axios.post(`/api/creations/${activeCreationId}/segments`, { segments });
    } catch (err) {
      console.error("Failed to save segments", err);
    }
  };

  const handleFinalizeDub = async () => {
    setIsProcessing(true);
    setStep('processing');
    setError(null);

    // Save current segments before dubbing
    await saveSegments();

    abortControllerRef.current = new AbortController();

    try {
      const payload = {
        creationId: activeCreationId,
        filename,
        segments,
        dub_language: dubLanguage,
        sub_language: language,
        use_cloning: useCloning
      };
      console.log("Sending finalize-dub payload:", payload);

      const response = await axios.post('/api/finalize-dub', payload, {
        signal: abortControllerRef.current.signal
      });

      if (response.data.dubbed_video_url) {
        setResultUrl(response.data.dubbed_video_url);
        setStep('result');
        fetchCreations();
      }
    } catch (err) {
      if (axios.isCancel(err)) return;
      console.error(err);
      setError('Failed to generate dubbed video.');
      setStep('options');
    } finally {
      if (!abortControllerRef.current?.signal.aborted) setIsProcessing(false);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = (e) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      const url = URL.createObjectURL(droppedFile);
      setFile(droppedFile);
      setMediaUrl(url);
    }
  };

  return (
    <div className="workspace-layout">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-section" style={{ padding: 0 }}>
            <div className="logo-icon" style={{ width: 32, height: 32, fontSize: '1rem' }}>
              <i className="fa-solid fa-microphone-lines"></i>
            </div>
            <h1 style={{ fontSize: '1.2rem' }}>ReVoice</h1>
          </div>
        </div>

        <div className="sidebar-content">
          <button className="new-creation-btn" onClick={handleNewVideo}>
            <i className="fa-solid fa-plus"></i> New Video
          </button>

          <div className="history-list">
            {creations.map((c) => (
              <div
                key={c._id}
                className={`history-item ${activeCreationId === c._id ? 'active' : ''}`}
                onClick={() => loadCreation(c._id)}
              >
                <i className="fa-solid fa-clapperboard"></i>
                <div className="history-info">
                  <span className="history-title">{c.title}</span>
                  <span className="history-status">{c.status}</span>
                </div>

                <div className={`history-item-actions ${activeMenuId === c._id ? 'menu-open' : ''}`}>
                  <button
                    className="more-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMenuId(activeMenuId === c._id ? null : c._id);
                    }}
                  >
                    <i className="fa-solid fa-ellipsis-vertical"></i>
                  </button>

                  {activeMenuId === c._id && (
                    <div className="context-menu" onClick={(e) => e.stopPropagation()}>
                      <button className="menu-item" onClick={() => { setActiveMenuId(null); loadCreation(c._id); }}>
                        <i className="fa-solid fa-folder-open"></i> Open
                      </button>
                      <button className="menu-item" onClick={() => {
                        setCreationToRename(c);
                        setNewTitle(c.title);
                        setShowRenameModal(true);
                        setActiveMenuId(null);
                      }}>
                        <i className="fa-solid fa-pen-to-square"></i> Rename
                      </button>
                      <button className="menu-item danger" onClick={() => {
                        setCreationToDelete(c);
                        setShowDeleteConfirm(true);
                        setActiveMenuId(null);
                      }}>
                        <i className="fa-solid fa-trash-can"></i> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="user-profile" style={{ margin: 0, padding: '0.5rem' }}>
            <img src={user?.avatar || `https://ui-avatars.com/api/?name=${user?.name}&background=6366f1&color=fff`} className="user-avatar" alt="avatar" />
            <div className="user-info">
              <span className="user-name">{user?.name}</span>
              <button className="logout-btn" onClick={() => logout()}>Logout</button>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="main-workspace">
        <header className="workspace-header">
          <div className="step-indicator" style={{ background: 'transparent', border: 'none' }}>
            <div className={`step ${step === 'upload' ? 'active' : ''}`}>
              <div className="step-num">1</div>
              <span>Upload</span>
            </div>
            <div className="step-arrow">→</div>
            <div className={`step ${['transcribing', 'editing'].includes(step) ? 'active' : ''}`}>
              <div className="step-num">2</div>
              <span>Edit</span>
            </div>
            <div className="step-arrow">→</div>
            <div className={`step ${['options', 'processing', 'result'].includes(step) ? 'active' : ''}`}>
              <div className="step-num">3</div>
              <span>Result</span>
            </div>
          </div>

          <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem' }} onClick={() => setShowResetModal(true)}>
            <i className="fa-solid fa-rotate-left"></i> Reset
          </button>
        </header>

        <div className="workspace-content scroller">
          <div className={`main-grid ${(!mediaUrl || step === 'result') ? 'centered' : ''}`}>
            {/* LEFT PANEL: ACTIONS */}
            <div className="panel action-panel scroller" style={{ gap: '2rem', padding: '2.5rem' }}>
              {/* STEP 1: UPLOAD */}
              {step === 'upload' && (
                <>
                  <div>
                    <h2>Upload & Initialize</h2>
                    <p style={{ color: 'var(--text-muted)' }}>Start by uploading your video and selecting the source dialect.</p>
                  </div>

                  <div
                    className={`upload-zone ${file ? 'has-file' : ''}`}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current.click()}
                    style={{ minHeight: '300px' }}
                  >
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="video/*" style={{ display: 'none' }} />
                    {file ? (
                      <div className="preview-placeholder">
                        <i className="fa-solid fa-file-video" style={{ fontSize: '3rem', color: '#818cf8' }}></i>
                        <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>{file.name}</p>
                        <button className="btn btn-secondary" style={{ marginTop: '1rem' }}>Change File</button>
                      </div>
                    ) : (
                      <>
                        <div className="cloud-icon" style={{ fontSize: '5rem' }}><i className="fa-solid fa-cloud-arrow-up"></i></div>
                        <h3>Drag & Drop video</h3>
                        <p style={{ opacity: 0.6 }}>MP4, MOV, or MKV supported</p>
                      </>
                    )}
                  </div>

                  <div className="option-group">
                    <h3>Source Dialect</h3>
                    <div className="radio-cards">
                      <div className={`radio-card ${sourceMode === 'original' ? 'selected' : ''}`} onClick={() => setSourceMode('original')}>
                        <i className="fa-solid fa-language"></i>
                        <span>Original</span>
                      </div>
                      <div className={`radio-card ${sourceMode === 'normalized_arabic' ? 'selected' : ''}`} onClick={() => setSourceMode('normalized_arabic')}>
                        <i className="fa-solid fa-wand-magic-sparkles"></i>
                        <span>Tunisian (Normalize)</span>
                      </div>
                    </div>
                  </div>

                  <button className="btn btn-primary btn-lg" disabled={!file || isProcessing} onClick={handleInitTranscription}>
                    {isProcessing ? 'Initializing...' : 'Next: Transcribe'} <i className="fa-solid fa-arrow-right"></i>
                  </button>
                </>
              )}

              {/* STEP 2: EDIT */}
              {(step === 'transcribing' || step === 'editing') && (
                <>
                  <div>
                    <h2>Review Transcription</h2>
                    <p style={{ color: 'var(--text-muted)' }}>Edit the generated text to ensure perfect dubbing.</p>
                  </div>

                  {step === 'transcribing' ? (
                    <div className="loader" style={{ padding: '4rem 0' }}>
                      <div className="spinner"></div>
                      <p>Analyzing audio & generating text...</p>
                    </div>
                  ) : (
                    <div className="editor-container" style={{ maxHeight: '500px' }}>
                      <div className="segments-list scroller">
                        {segments.map((seg, idx) => (
                          <div key={idx} className="segment-card" style={{ cursor: 'default' }}>
                            <div className="segment-header">
                              <span>Segment {idx + 1}</span>
                              <span>{formatTime(seg.start)} - {formatTime(seg.end)}</span>
                            </div>

                            {sourceMode === 'normalized_arabic' ? (
                              <div className="input-container">
                                <label className="input-label">Normalized Transcription (MSA)</label>
                                <textarea
                                  className="segment-input"
                                  value={seg.text}
                                  onChange={(e) => {
                                    const updated = [...segments];
                                    updated[idx].text = e.target.value;
                                    setSegments(updated);
                                  }}
                                  rows={3}
                                  placeholder="Refining to MSA..."
                                />
                              </div>
                            ) : (
                              <textarea
                                className="segment-input"
                                value={seg.text}
                                onChange={(e) => {
                                  const updated = [...segments];
                                  updated[idx].text = e.target.value;
                                  setSegments(updated);
                                }}
                                rows={2}
                                style={{ marginTop: '0.5rem' }}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="action-bar">
                    <button className="btn btn-secondary" onClick={() => setStep('upload')}>Back</button>
                    <button className="btn btn-primary" onClick={() => setStep('options')}>Confirm & Continue <i className="fa-solid fa-check"></i></button>
                  </div>
                </>
              )}

              {/* STEP 3: OPTIONS & RESULT */}
              {(step === 'options' || step === 'processing' || step === 'result') && (
                <>
                  {step === 'result' ? (
                    <>
                      <div>
                        <h2>Dubbed Result</h2>
                        <p style={{ color: 'var(--text-muted)' }}>Your video has been successfully processed.</p>
                      </div>
                      <div className="result-video-container">
                        <video src={resultUrl} controls autoPlay />
                      </div>
                      <div className="action-bar">
                        <button className="btn btn-secondary" onClick={() => setStep('options')}>Re-dub</button>
                        <a href={resultUrl} download="dubbed_video.mp4" style={{ flex: 1, textDecoration: 'none' }}>
                          <button className="btn btn-success" style={{ width: '100%' }}><i className="fa-solid fa-download"></i> Download Video</button>
                        </a>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <h2>Finalize Dubbing</h2>
                        <p style={{ color: 'var(--text-muted)' }}>Select target languages for subtitles and audio.</p>
                      </div>

                      <div className="dub-options-wrapper">
                        <div className="option-group">
                          <h3>Subtitle Language</h3>
                          <div className="language-tags">
                            {['original', 'en', 'fr', 'es', 'ar'].map(l => (
                              <button key={l} className={`lang-chip ${language === l ? 'active' : ''}`} onClick={() => setLanguage(l)}>{l.toUpperCase()}</button>
                            ))}
                          </div>
                        </div>
                        <div className="option-group">
                          <h3>Dubbing Language</h3>
                          <div className="language-tags">
                            {['original', 'en', 'fr', 'es', 'ar'].map(l => (
                              <button key={l} className={`lang-chip ${dubLanguage === l ? 'active' : ''}`} onClick={() => setDubLanguage(l)}>{l.toUpperCase()}</button>
                            ))}
                          </div>
                        </div>

                        <div className="option-group" style={{ marginTop: '1.5rem' }}>
                          <div
                            className={`toggle-option`}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '1rem',
                              padding: '1rem',
                              background: 'rgba(255,255,255,0.02)',
                              borderRadius: '12px',
                              cursor: 'not-allowed',
                              border: '1px solid rgba(255,255,255,0.05)',
                              opacity: 0.6,
                              transition: 'all 0.2s ease'
                            }}
                          >
                            <div className="toggle-info" style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <h4 style={{ margin: 0 }}>Clone Original Voices</h4>
                                <span style={{
                                  fontSize: '0.7rem',
                                  background: '#f59e0b20',
                                  color: '#fbbf24',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  border: '1px solid #f59e0b40'
                                }}>
                                  IN DEV
                                </span>
                              </div>
                              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                Use ElevenLabs Instant Voice Cloning to replicate original speakers.
                              </p>
                              <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: '#94a3b8', fontStyle: 'italic' }}>
                                <i className="fa-solid fa-code-branch"></i> Feature is currently in development process.
                              </p>
                            </div>
                            <div
                              className="toggle-switch"
                              style={{
                                width: '44px',
                                height: '24px',
                                background: '#334155',
                                borderRadius: '12px',
                                position: 'relative',
                                transition: 'background 0.2s'
                              }}
                            >
                              <div
                                style={{
                                  width: '18px',
                                  height: '18px',
                                  background: '#94a3b8',
                                  borderRadius: '50%',
                                  position: 'absolute',
                                  top: '3px',
                                  left: '3px',
                                  transition: 'left 0.2s'
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {step === 'processing' ? (
                        <div className="loader" style={{ padding: '2rem 0' }}>
                          <div className="spinner"></div>
                          <p>Generating your video... This may take a minute.</p>
                        </div>
                      ) : (
                        <div className="action-bar">
                          <button className="btn btn-secondary" onClick={() => setStep('editing')}>Back</button>
                          <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleFinalizeDub}>Generate Video <i className="fa-solid fa-sparkles"></i></button>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            {/* RIGHT PANEL: PREVIEW */}
            {(mediaUrl && step !== 'result') && (
              <div className="panel preview-panel">
                <div className="preview-wrapper">
                  <video src={mediaUrl} controls />
                </div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div style={{ position: 'fixed', bottom: '2rem', right: '2rem', background: '#ef4444', color: '#fff', padding: '1rem 2rem', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', animation: 'fadeIn 0.3s ease' }}>
            <i className="fa-solid fa-circle-exclamation"></i> {error}
          </div>
        )}
      </main>

      {/* MODALS */}
      {showResetModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Reset Session?</h2>
            <p>This will clear your current progress. Your history will remain in the sidebar.</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowResetModal(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => { clearCreationState(); setStep('upload'); setShowResetModal(false); }}>Reset</button>
            </div>
          </div>
        </div>
      )}

      {showRenameModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Rename Project</h2>
            <div className="input-group" style={{ margin: '1.5rem 0' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Project Name</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="modal-input"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  border: '1px solid #e2e8f0',
                  fontSize: '1rem'
                }}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowRenameModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleRename}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ color: '#ef4444' }}>Delete Project?</h2>
            <p>Are you sure you want to delete <strong>"{creationToDelete?.title}"</strong>? This action cannot be undone and all files will be removed.</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDelete(creationToDelete._id)}>Confirm Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Workspace;
