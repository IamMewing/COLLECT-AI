import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useStore } from '../store/useStore';
import { getWorkspace } from '../lib/workspace';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import gsap from 'gsap';

interface InitTask {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  realTask?: () => Promise<void>;
}

export const InitializeWorkspace: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tasks, setTasks] = useState<InitTask[]>([
    { id: 'boot',         label: 'CollectAI Employee Booting...', status: 'pending' },
    { id: 'workspace',    label: 'Creating Workspace...', status: 'pending' },
    { id: 'firebase',     label: 'Connecting Firebase...', status: 'pending' },
    { id: 'profile',      label: 'Reading Company Profile...', status: 'pending' },
    { id: 'memory',       label: 'Building AI Memory...', status: 'pending' },
    { id: 'engine',       label: 'Initializing Collection Engine...', status: 'pending' },
    { id: 'gemini',       label: 'Loading Gemini...', status: 'pending' },
    { id: 'intelligence', label: 'Creating Workspace Intelligence...', status: 'pending' },
    { id: 'ready',        label: 'Ready.', status: 'pending' },
  ]);
  const [allDone, setAllDone] = useState(false);

  const updateTask = (id: string, status: InitTask['status']) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  };

  // ── Radar canvas background ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);
    let angle = 0;
    let animId: number;

    const draw = () => {
      ctx.fillStyle = 'rgba(10,10,10,0.06)';
      ctx.fillRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) * 0.42;

      // Rings
      for (let r = radius / 4; r <= radius; r += radius / 4) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,212,0,0.05)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // Cross hairs
      ctx.strokeStyle = 'rgba(255,212,0,0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius); ctx.stroke();

      // Sweep
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, angle, angle + 0.16);
      ctx.lineTo(cx, cy);
      ctx.fillStyle = 'rgba(255,212,0,0.08)';
      ctx.fill();

      angle += 0.015;
      animId = requestAnimationFrame(draw);
    };
    draw();

    const onResize = () => { width = canvas.width = window.innerWidth; height = canvas.height = window.innerHeight; };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', onResize); };
  }, []);

  // ── Sequence executor ────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;

    const TASK_IDS = ['boot', 'workspace', 'firebase', 'profile', 'memory', 'engine', 'gemini', 'intelligence', 'ready'];
    const DELAY = 750; // ~6.75 seconds total duration

    let cancelled = false;

    const run = async () => {
      // Mark session immediately so AuthGuard doesn't bounce back during sequence execution
      sessionStorage.setItem('workspaceInitialized', user.uid);

      // Initiate real background data pre-loading tasks concurrently
      const realPreload = Promise.all([
        getWorkspace(user.uid).catch(() => null),
        useStore.getState().fetchBusinesses().catch(() => null),
        useStore.getState().loadAllData().catch(() => null),
      ]);

      for (let i = 0; i < TASK_IDS.length; i++) {
        if (cancelled) break;
        const id = TASK_IDS[i];
        updateTask(id, 'running');
        await new Promise(r => setTimeout(r, DELAY));
        if (cancelled) break;
        updateTask(id, 'done');
      }

      // Ensure all real preloading tasks finish before setting ready
      await realPreload;

      if (!cancelled) {
        try {
          await setDoc(doc(db, 'users', user.uid), {
            workspaceInitialized: true,
            updatedAt: serverTimestamp(),
          }, { merge: true });
        } catch (err) {
          console.error('[InitializeWorkspace] Failed to set workspaceInitialized flag:', err);
        }
        sessionStorage.setItem('workspaceInitialized', user.uid);
        setAllDone(true);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [user?.uid]);

  // ── Transition to WelcomeScreen when done ───────────────────────────────
  useEffect(() => {
    if (!allDone) return;
    const t = setTimeout(() => {
      if (containerRef.current) {
        gsap.to(containerRef.current, {
          opacity: 0,
          duration: 0.7,
          ease: 'power2.inOut',
          onComplete: () => navigate('/welcome', { replace: true }),
        });
      } else {
        navigate('/welcome', { replace: true });
      }
    }, 800);
    return () => clearTimeout(t);
  }, [allDone, navigate]);

  const doneTasks = tasks.filter(t => t.status === 'done').length;
  const progress = Math.round((doneTasks / tasks.length) * 100);

  return (
    <div ref={containerRef} style={{
      position: 'fixed', inset: 0,
      background: '#0A0A0A', color: '#FAFAF7',
      zIndex: 999999,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '32px', overflow: 'hidden',
    }}>
      <canvas ref={canvasRef} style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1,
      }} />

      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '32px', width: '100%', maxWidth: '480px' }}>

        {/* Animated logo */}
        <div style={{ position: 'relative' }}>
          <div style={{
            width: '64px', height: '64px',
            border: '2px solid var(--yellow)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'rotateSlow 12s linear infinite',
          }}>
            <div style={{
              width: '28px', height: '28px',
              background: 'var(--yellow)',
              boxShadow: '0 0 20px rgba(255,212,0,0.6)',
            }} />
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.8rem',
            fontWeight: 800,
            color: 'var(--yellow)',
            letterSpacing: '-0.02em',
          }}>
            Initializing CollectAI
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-label)',
            color: 'rgba(255,255,255,0.4)',
            marginTop: '6px',
          }}>
            Setting up your AI employee workspace
          </div>
        </div>

        {/* Task list */}
        <div style={{
          width: '100%',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,212,0,0.12)',
          borderRadius: '4px',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}>
          {tasks.map(task => (
            <div key={task.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              opacity: task.status === 'pending' ? 0.25 : 1,
              transition: 'opacity 0.3s ease',
            }}>
              {/* Status icon */}
              <div style={{ width: '18px', flexShrink: 0, textAlign: 'center' }}>
                {task.status === 'done' && (
                  <span style={{ color: 'var(--yellow)', fontSize: '0.85rem' }}>✓</span>
                )}
                {task.status === 'running' && (
                  <span style={{
                    display: 'inline-block',
                    width: '10px', height: '10px',
                    border: '1.5px solid rgba(255,212,0,0.4)',
                    borderTopColor: 'var(--yellow)',
                    borderRadius: '50%',
                    animation: 'spin 0.7s linear infinite',
                  }} />
                )}
                {task.status === 'pending' && (
                  <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.85rem' }}>○</span>
                )}
              </div>

              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-caption)',
                color: task.status === 'done' ? 'rgba(255,255,255,0.6)'
                  : task.status === 'running' ? '#FAFAF7'
                  : 'rgba(255,255,255,0.25)',
                transition: 'color 0.3s',
              }}>
                {task.label}{task.status === 'running' ? '...' : ''}
              </span>

              {task.status === 'done' && (
                <span style={{
                  marginLeft: 'auto',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-label)',
                  color: 'rgba(255,212,0,0.6)',
                }}>OK</span>
              )}
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div style={{ width: '100%' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontFamily: 'var(--font-mono)', fontSize: 'var(--text-label)',
            color: 'rgba(255,255,255,0.35)', marginBottom: '8px',
          }}>
            <span>INITIALIZING</span>
            <span>{progress}%</span>
          </div>
          <div style={{ height: '2px', background: 'rgba(255,255,255,0.08)', borderRadius: '1px' }}>
            <div style={{
              height: '100%', background: 'var(--yellow)',
              width: `${progress}%`,
              borderRadius: '1px',
              transition: 'width 0.5s var(--ease-out)',
              boxShadow: '0 0 8px rgba(255,212,0,0.5)',
            }} />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes rotateSlow { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default InitializeWorkspace;
