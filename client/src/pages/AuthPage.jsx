import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link, useLocation } from 'react-router-dom';

const AuthPage = () => {
    const { login, signup, user, loading } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    // Use URL path to determine initial state, but local state drives the transition
    const isInitialLogin = location.pathname === '/login';
    const [isSignIn, setIsSignIn] = useState(isInitialLogin);

    // Form States
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [error, setError] = useState('');

    // Auto-redirect if already logged in
    React.useEffect(() => {
        if (!loading && user) {
            navigate('/workspace');
        }
    }, [user, loading, navigate]);

    const handleToggle = () => {
        setIsSignIn(!isSignIn);
        setError('');
        // Sync URL for UX (optional, but good for back button)
        navigate(isSignIn ? '/signup' : '/login', { replace: true });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        try {
            if (!isSignIn) {
                await signup(email, password, name);
            } else {
                await login(email, password);
            }
            navigate('/workspace');
        } catch (err) {
            setError(err.response?.data?.error || 'Authentication failed');
        }
    };

    return (
        <div className="auth-wrapper">
            <div className={`auth-container-sleek ${!isSignIn ? 'right-panel-active' : ''}`} id="auth-container">

                {/* SIGN UP FORM */}
                <div className="form-container sign-up-container">
                    <form onSubmit={handleSubmit}>
                        <h1>Create Account</h1>
                        <div className="social-container">
                            <a href="#" className="social"><i className="fab fa-facebook-f"></i></a>
                            <a href="#" className="social"><i className="fab fa-google-plus-g"></i></a>
                            <a href="#" className="social"><i className="fab fa-linkedin-in"></i></a>
                        </div>
                        <span>or use your email for registration</span>
                        <input type="text" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
                        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                        {error && !isSignIn && <p className="auth-error-msg">{error}</p>}
                        <button type="submit" className="btn-primary">Sign Up</button>
                    </form>
                </div>

                {/* SIGN IN FORM */}
                <div className="form-container sign-in-container">
                    <form onSubmit={handleSubmit}>
                        <h1>Sign in</h1>
                        <div className="social-container">
                            <a href="#" className="social"><i className="fab fa-facebook-f"></i></a>
                            <a href="#" className="social"><i className="fab fa-google-plus-g"></i></a>
                            <a href="#" className="social"><i className="fab fa-linkedin-in"></i></a>
                        </div>
                        <span>or use your account</span>
                        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                        <a href="#">Forgot your password?</a>
                        {error && isSignIn && <p className="auth-error-msg">{error}</p>}
                        <button type="submit" className="btn-primary">Sign In</button>
                    </form>
                </div>

                {/* OVERLAY */}
                <div className="overlay-container">
                    <div className="overlay">
                        <div className="overlay-panel overlay-left">
                            <h1>Welcome Back!</h1>
                            <p>To keep connected with us please login with your personal info</p>
                            <button className="ghost" onClick={handleToggle}>Sign In</button>
                        </div>
                        <div className="overlay-panel overlay-right">
                            <h1>Hello, Friend!</h1>
                            <p>Enter your personal details and start journey with us</p>
                            <button className="ghost" onClick={handleToggle}>Sign Up</button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="back-home">
                <Link to="/"><i className="fa-solid fa-arrow-left"></i> Back to Home</Link>
            </div>
        </div>
    );
};

export default AuthPage;
