import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';

const LandingPage = () => {
    const { user, loading } = useAuth();
    const navigate = useNavigate();

    // Auto-redirect to workspace if already logged in
    React.useEffect(() => {
        if (!loading && user) {
            navigate('/workspace');
        }
    }, [user, loading, navigate]);

    if (loading && !user) return null; // Or a loader

    return (
        <div className="landing-container">
            <div className="bg-glow"></div>
            <nav className="landing-nav animate-fade-in">
                <div className="logo-section">
                    <div className="logo-icon"><i className="fa-solid fa-microphone-lines"></i></div>
                    <h1>ReVoice</h1>
                </div>
                <div className="nav-actions">
                    {user ? (
                        <Link to="/workspace" className="btn btn-primary">Go to Workspace <i className="fa-solid fa-arrow-right"></i></Link>
                    ) : (
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <Link to="/login" className="btn btn-secondary">Login</Link>
                            <Link to="/signup" className="btn btn-primary">Sign Up Free</Link>
                        </div>
                    )}
                </div>
            </nav>

            <main className="hero-section">
                <div className="hero-content animate-fade-in" style={{ animationDelay: '0.2s' }}>
                    <div className="hero-tagline">
                        <span className="badge">AI-POWERED</span>
                        <span>Your Voice, Every Language.</span>
                    </div>
                    <h1 className="hero-title">Break Language Barriers <br />With AI Dubbing</h1>
                    <p className="hero-description">
                        Transform your videos into 50+ languages with high-fidelity AI voices.
                        Tunisian dialect normalization included.
                    </p>
                    <div className="hero-actions">
                        {user ? (
                            <Link to="/workspace" className="btn btn-primary btn-lg">Open Workspace <i className="fa-solid fa-wand-magic-sparkles"></i></Link>
                        ) : (
                            <>
                                <Link to="/signup" className="btn btn-primary btn-lg">Get Started Free <i className="fa-solid fa-bolt"></i></Link>
                                <a href="#features" className="btn btn-secondary btn-lg">Explore Features</a>
                            </>
                        )}
                    </div>
                </div>

                <div className="hero-visual animate-float">
                    <div className="glass-card visual-mockup">
                        <div className="mockup-header">
                            <div className="dot red"></div>
                            <div className="dot yellow"></div>
                            <div className="dot green"></div>
                        </div>
                        <div className="mockup-body">
                            <i className="fa-solid fa-clapperboard" style={{ fontSize: '5rem', opacity: 0.2 }}></i>
                            <div className="processing-bar">
                                <div className="bar-fill"></div>
                            </div>
                            <span>Processing Neural Voices...</span>
                        </div>
                    </div>
                </div>
            </main>

            <section id="features" className="features-section">
                <div className="section-header animate-fade-in">
                    <h2>Everything you need for global content</h2>
                    <p>Designed for professional creators and businesses.</p>
                </div>
                <div className="features-grid">
                    {[
                        { icon: 'fa-file-waveform', title: 'AI Transcription', text: 'High accuracy speech-to-text with dialect support.' },
                        { icon: 'fa-pen-to-square', title: 'Editable Transcripts', text: 'Perfect your subtitles with our intuitive editor.' },
                        { icon: 'fa-language', title: 'Normalization', text: 'Convert Tunisian Arabic to MSA automatically.' },
                        { icon: 'fa-wand-magic-sparkles', title: 'AI Dubbing', text: 'Generate natural voices in 50+ languages.' }
                    ].map((f, i) => (
                        <div key={i} className="feature-card animate-fade-in" style={{ animationDelay: `${0.4 + (i * 0.1)}s` }}>
                            <div className="feature-icon">
                                <i className={`fa-solid ${f.icon}`}></i>
                            </div>
                            <h3>{f.title}</h3>
                            <p>{f.text}</p>
                        </div>
                    ))}
                </div>
            </section>

            <footer className="landing-footer">
                <p>&copy; 2026 ReVoice. Professional AI Dubbing Studio.</p>
            </footer>
        </div>
    );
};

export default LandingPage;
