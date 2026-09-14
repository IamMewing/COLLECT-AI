import React, { useRef, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Html, Line } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { SweepResult, ApproveResult, ApiError } from '../types';
import { Zap, AlertTriangle, RefreshCw } from 'lucide-react';

interface Graph3DHeroProps {
  sweepResult: SweepResult | null;
  approveResult: ApproveResult | null;
  isSweeping: boolean;
  isApproving: boolean;
  error: ApiError | null;
  onRetry?: () => void;
}

// ── Node Definitions ──────────────────────────────────────────────────────────
interface NodeData {
  id: string;
  name: string;
  sub: string;
  position: [number, number, number];
  shape: 'octahedron' | 'icosahedron' | 'cylinder' | 'dodecahedron' | 'torus';
  colorDefault: string;
}

const NODES: NodeData[] = [
  {
    id: 'risk_assess',
    name: 'Risk Assess',
    sub: 'calculate_risk_score',
    position: [-3.8, 1.4, 0],
    shape: 'octahedron',
    colorDefault: '#94A3B8',
  },
  {
    id: 'probability',
    name: 'Probability',
    sub: 'predict_payment_probability',
    position: [-3.8, -1.4, 0],
    shape: 'icosahedron',
    colorDefault: '#94A3B8',
  },
  {
    id: 'plan',
    name: 'Plan Strategy',
    sub: 'branch conditional edge',
    position: [0, 0, 0],
    shape: 'cylinder',
    colorDefault: '#94A3B8',
  },
  {
    id: 'draft',
    name: 'Draft Message',
    sub: 'tone & channel generation',
    position: [3.8, 0, 0],
    shape: 'dodecahedron',
    colorDefault: '#94A3B8',
  },
  {
    id: 'reflect',
    name: 'Reflection Gate',
    sub: 'relationship score delta',
    position: [7.0, 0, 0],
    shape: 'torus',
    colorDefault: '#94A3B8',
  },
];

// ── 3D Node Mesh Component ────────────────────────────────────────────────────
const NodeMesh: React.FC<{
  node: NodeData;
  status: 'idle' | 'thinking' | 'completed' | 'dormant' | 'error';
  signalColor: string;
  detailText: string;
}> = ({ node, status, signalColor, detailText }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame((state) => {
    if (!meshRef.current) return;
    const time = state.clock.getElapsedTime();

    if (status === 'thinking') {
      const scale = 1 + Math.sin(time * 6) * 0.14;
      meshRef.current.scale.set(scale, scale, scale);
      meshRef.current.rotation.y = time * 2;
      meshRef.current.rotation.x = time * 1.2;
    } else {
      meshRef.current.scale.set(1, 1, 1);
      meshRef.current.rotation.y = time * 0.3;
      meshRef.current.rotation.x = time * 0.15;
    }
  });

  const materialColor = useMemo(() => {
    if (status === 'error') return '#FF3B6B';
    if (status === 'thinking') return '#FFD23F';
    if (status === 'dormant') return '#1E293B';
    if (status === 'completed') return signalColor;
    // idle: visible slate, not near-black
    return '#4A5568';
  }, [status, signalColor]);

  const emissiveColor = useMemo(() => {
    if (status === 'error') return '#FF3B6B';
    if (status === 'thinking') return '#FFD23F';
    if (status === 'completed') return signalColor;
    if (status === 'dormant') return '#0F172A';
    // idle: faint cool-teal glow so nodes are always visibly lit
    return '#3B82F6';
  }, [status, signalColor]);

  const emissiveIntensity = useMemo(() => {
    if (status === 'thinking') return 2.0;
    if (status === 'completed') return 1.3;
    if (status === 'error') return 1.6;
    if (status === 'dormant') return 0.05;
    // idle: high enough to glow through bloom
    return 0.5;
  }, [status]);

  return (
    <group position={node.position}>
      <mesh
        ref={meshRef}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        {node.shape === 'octahedron' && <octahedronGeometry args={[0.75, 0]} />}
        {node.shape === 'icosahedron' && <icosahedronGeometry args={[0.75, 0]} />}
        {node.shape === 'cylinder' && <cylinderGeometry args={[0.75, 0.75, 0.9, 6]} />}
        {node.shape === 'dodecahedron' && <dodecahedronGeometry args={[0.72, 0]} />}
        {node.shape === 'torus' && <torusGeometry args={[0.65, 0.22, 16, 32]} />}

        <meshStandardMaterial
          color={materialColor}
          emissive={emissiveColor}
          emissiveIntensity={emissiveIntensity}
          roughness={0.2}
          metalness={0.9}
          wireframe={status === 'dormant'}
          toneMapped={false}
        />
      </mesh>

      {/* Persistent / Hover HTML Telemetry Label */}
      <Html position={[0, -1.2, 0]} center distanceFactor={12}>
        <div
          style={{
            background: 'rgba(10, 14, 23, 0.92)',
            border: `1px solid ${status === 'thinking' ? '#FFD23F' : status === 'completed' ? signalColor : '#1E293B'}`,
            borderRadius: '4px',
            padding: '4px 8px',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 4px 14px rgba(0,0,0,0.6)',
            textAlign: 'center',
            transform: hovered ? 'scale(1.08)' : 'scale(1)',
            transition: 'transform 0.15s ease',
          }}
        >
          <div
            style={{
              fontFamily: 'Space Grotesk, sans-serif',
              fontWeight: 700,
              fontSize: '11px',
              color: status === 'thinking' ? '#FFD23F' : '#F1F5F9',
              letterSpacing: '0.04em',
            }}
          >
            {node.name}
          </div>
          <div
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '9px',
              color: status === 'completed' ? signalColor : '#94A3B8',
              marginTop: '1px',
            }}
          >
            {detailText}
          </div>
        </div>
      </Html>
    </group>
  );
};

// ── Glowing Curved Edge Component (drei <Line>) ───────────────────────────────
const EdgeTrail: React.FC<{
  start: [number, number, number];
  end: [number, number, number];
  active: boolean;
  suppressed?: boolean;
  color?: string;
}> = ({ start, end, active, suppressed, color = '#00E5C7' }) => {
  const points = useMemo(() => {
    const midX = (start[0] + end[0]) / 2;
    const midY = (start[1] + end[1]) / 2;
    const curveHeight = start[1] !== end[1] ? 0.2 : 0;
    const p1 = new THREE.Vector3(...start);
    const cp = new THREE.Vector3(midX, midY + curveHeight, 0);
    const p3 = new THREE.Vector3(...end);
    const curve = new THREE.QuadraticBezierCurve3(p1, cp, p3);
    return curve.getPoints(48).map((p) => [p.x, p.y, p.z] as [number, number, number]);
  }, [start, end]);

  const lineColor = suppressed ? '#1E293B' : active ? color : '#334155';
  const lineWidth = active ? 2.5 : 1.2;
  const lineOpacity = suppressed ? 0.15 : active ? 0.9 : 0.35;

  return (
    <Line
      points={points}
      color={lineColor}
      lineWidth={lineWidth}
      transparent
      opacity={lineOpacity}
    />
  );
};

// ── Inner 3D Scene ────────────────────────────────────────────────────────────
const SceneContent: React.FC<Graph3DHeroProps> = ({
  sweepResult,
  approveResult,
  isSweeping,
  isApproving,
  error,
}) => {
  const isNoAction = sweepResult?.plan.branch === 'no_action' || sweepResult?.draft === null;

  // Compute node statuses
  const nodeStatuses = useMemo(() => {
    if (error) {
      return {
        risk_assess: 'error',
        probability: 'error',
        plan: 'error',
        draft: 'dormant',
        reflect: 'dormant',
      };
    }

    if (isSweeping) {
      return {
        risk_assess: 'thinking',
        probability: 'thinking',
        plan: 'thinking',
        draft: 'idle',
        reflect: 'idle',
      };
    }

    if (isApproving) {
      return {
        risk_assess: 'completed',
        probability: 'completed',
        plan: 'completed',
        draft: 'completed',
        reflect: 'thinking',
      };
    }

    if (approveResult) {
      return {
        risk_assess: 'completed',
        probability: 'completed',
        plan: 'completed',
        draft: 'completed',
        reflect: 'completed',
      };
    }

    if (sweepResult) {
      if (isNoAction) {
        return {
          risk_assess: 'completed',
          probability: 'completed',
          plan: 'completed',
          draft: 'dormant', // Explicitly dark & dormant
          reflect: 'dormant',
        };
      }
      return {
        risk_assess: 'completed',
        probability: 'completed',
        plan: 'completed',
        draft: 'completed',
        reflect: 'idle',
      };
    }

    return {
      risk_assess: 'idle',
      probability: 'idle',
      plan: 'idle',
      draft: 'idle',
      reflect: 'idle',
    };
  }, [sweepResult, approveResult, isSweeping, isApproving, error, isNoAction]);

  // Compute dynamic detail text for each node
  const detailTexts = useMemo(() => {
    if (error) {
      return {
        risk_assess: 'STALLED',
        probability: 'STALLED',
        plan: 'STALLED',
        draft: 'OFFLINE',
        reflect: 'STANDBY',
      };
    }

    if (isSweeping) {
      return {
        risk_assess: 'EVALUATING...',
        probability: 'FORECASTING...',
        plan: 'AWAITING INPUTS',
        draft: 'STANDBY',
        reflect: 'STANDBY',
      };
    }

    if (sweepResult) {
      return {
        risk_assess: `${sweepResult.risk.category} (${sweepResult.risk.score}/100)`,
        probability: `${sweepResult.probability.probability}% PROBABILITY`,
        plan: isNoAction ? 'BRANCH: NO_ACTION' : `BRANCH: ${sweepResult.plan.branch.toUpperCase()}`,
        draft: isNoAction ? 'SKIPPED (NO ACTION)' : `${sweepResult.plan.channel.toUpperCase()} · ${sweepResult.plan.tone.toUpperCase()}`,
        reflect: approveResult?.status === 'sent' || approveResult?.status === 'sent (mock)' ? 'APPROVED & LOGGED' : approveResult?.status === 'skipped' ? 'REJECTED' : 'AWAITING GATE',
      };
    }

    return {
      risk_assess: 'IDLE (PARALLEL)',
      probability: 'IDLE (PARALLEL)',
      plan: 'IDLE (FAN-IN)',
      draft: 'CONDITIONAL EDGE',
      reflect: 'PHASE 2 POST-GATE',
    };
  }, [sweepResult, approveResult, isSweeping, error, isNoAction]);

  // Determine signal colors based on actual results
  const riskSignal = sweepResult?.risk.category === 'Critical' ? '#FF3B6B' : sweepResult?.risk.category === 'High' ? '#FF9F1C' : '#00E5C7';
  const probSignal = sweepResult?.probability.probability && sweepResult.probability.probability >= 70 ? '#00E5C7' : '#FF9F1C';
  const planSignal = isNoAction ? '#00E5C7' : sweepResult?.plan.tone === 'urgent' ? '#FF3B6B' : '#FF9F1C';
  const draftSignal = sweepResult?.plan.tone === 'urgent' ? '#FF3B6B' : '#00E5C7';
  const reflectSignal = approveResult?.status === 'skipped' ? '#FF3B6B' : '#00E5C7';

  return (
    <>
      {/* ── Lighting Rig ─────────────────────────────────────────────── */}
      <ambientLight intensity={0.25} />
      <directionalLight position={[10, 10, 5]} intensity={0.8} />
      {/* Main key light: warm gold cast */}
      <pointLight position={[0, 0, 5]} intensity={isSweeping ? 3.0 : 1.2} color="#FFD23F" />
      {/* Fill light: cool teal from below-left */}
      <pointLight position={[-5, -3, 3]} intensity={0.6} color="#00E5C7" />
      {/* Rim light: faint magenta-red from right */}
      <pointLight position={[8, 2, 4]} intensity={0.4} color="#FF3B6B" />

      <Float speed={1.2} rotationIntensity={0.15} floatIntensity={0.25}>
        {/* Edges */}
        <EdgeTrail
          start={NODES[0].position}
          end={NODES[2].position}
          active={nodeStatuses.risk_assess === 'completed' || isSweeping}
          color={isSweeping ? '#FFD23F' : riskSignal}
        />
        <EdgeTrail
          start={NODES[1].position}
          end={NODES[2].position}
          active={nodeStatuses.probability === 'completed' || isSweeping}
          color={isSweeping ? '#FFD23F' : probSignal}
        />
        <EdgeTrail
          start={NODES[2].position}
          end={NODES[3].position}
          active={!isNoAction && nodeStatuses.draft === 'completed'}
          suppressed={isNoAction}
          color={planSignal}
        />
        <EdgeTrail
          start={NODES[3].position}
          end={NODES[4].position}
          active={nodeStatuses.reflect === 'completed' || isApproving}
          color={reflectSignal}
        />

        {/* Nodes */}
        <NodeMesh
          node={NODES[0]}
          status={nodeStatuses.risk_assess as any}
          signalColor={riskSignal}
          detailText={detailTexts.risk_assess}
        />
        <NodeMesh
          node={NODES[1]}
          status={nodeStatuses.probability as any}
          signalColor={probSignal}
          detailText={detailTexts.probability}
        />
        <NodeMesh
          node={NODES[2]}
          status={nodeStatuses.plan as any}
          signalColor={planSignal}
          detailText={detailTexts.plan}
        />
        <NodeMesh
          node={NODES[3]}
          status={nodeStatuses.draft as any}
          signalColor={draftSignal}
          detailText={detailTexts.draft}
        />
        <NodeMesh
          node={NODES[4]}
          status={nodeStatuses.reflect as any}
          signalColor={reflectSignal}
          detailText={detailTexts.reflect}
        />
      </Float>

      {/* ── Post-Processing: Bloom ────────────────────────────────── */}
      <EffectComposer>
        <Bloom
          luminanceThreshold={0.3}
          luminanceSmoothing={0.7}
          intensity={1.4}
          mipmapBlur
        />
      </EffectComposer>
    </>
  );
};

// ── Exported Component with HUD and Error State ───────────────────────────────
export const Graph3DHero: React.FC<Graph3DHeroProps> = (props) => {
  const { sweepResult, approveResult, isSweeping, isApproving, error, onRetry } = props;
  const isNoAction = sweepResult?.plan.branch === 'no_action' || sweepResult?.draft === null;

  return (
    <div
      className={`ledger-panel glass-panel${isSweeping ? ' conic-border-active' : ''}`}
      style={{
        position: 'relative',
        height: '380px',
        width: '100%',
        background: 'radial-gradient(ellipse at 50% 40%, #151C2C 0%, #0A0E17 80%)',
        border: error ? '1px solid rgba(255, 59, 107, 0.5)' : isSweeping ? '1px solid rgba(255, 210, 63, 0.4)' : undefined,
      }}
    >
      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [1.6, 0, 11], fov: 42 }}
        style={{ width: '100%', height: '100%' }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      >
        <SceneContent {...props} />
      </Canvas>

      {/* Top Left: Graph HUD Telemetry */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '20px',
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="mono-label" style={{ color: '#F1F5F9', fontSize: '0.75rem', fontWeight: 700 }}>
            STRANDS MULTI-AGENT GRAPH TOPOLOGY
          </span>
          {isSweeping ? (
            <span className="ledger-badge ledger-badge-gold">
              <span className="pulse-thinking">⚡</span> LIVE REASONING PULSE
            </span>
          ) : isApproving ? (
            <span className="ledger-badge ledger-badge-healthy">
              <Zap size={11} /> EXECUTING DISPATCH
            </span>
          ) : approveResult ? (
            <span className="ledger-badge ledger-badge-healthy">CYCLE COMPLETED</span>
          ) : sweepResult ? (
            <span className="ledger-badge ledger-badge-healthy">SWEEP COMPILED</span>
          ) : (
            <span className="ledger-badge ledger-badge-neutral">TOPOLOGY READY</span>
          )}
        </div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          graph.py: Parallel Entry (Risk + Probability) ➔ Plan Strategy ➔ Conditional Edge ➔ Draft
        </p>
      </div>

      {/* Top Right: Real Decision Badge (especially NO_ACTION termination moment) */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          right: '20px',
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {isNoAction && sweepResult && (
          <div
            className="stamp-seal stamp-seal-healthy"
            style={{ fontSize: '0.68rem', letterSpacing: '0.08em' }}
          >
            🛡️ CONDITIONAL EDGE TERMINATED · NO ACTION
          </div>
        )}
      </div>

      {/* Explicit Calm On-Brand Error/Failure Overlay (Rate limits / Timeouts) */}
      {error && (
        <div
          style={{
            position: 'absolute',
            bottom: '16px',
            left: '20px',
            right: '20px',
            background: 'rgba(19, 24, 38, 0.95)',
            border: '1px solid rgba(255, 59, 107, 0.45)',
            borderRadius: '6px',
            padding: '12px 16px',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '4px',
                background: 'rgba(255, 59, 107, 0.15)',
                border: '1px solid var(--critical)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--critical)',
              }}
            >
              <AlertTriangle size={18} />
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.9rem', color: '#F1F5F9' }}>
                Telemetry Interrupted · {error.error || 'Provider Rate Limit or Timeout'}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                {error.details || 'Gemini API limit reached. The system preserves graph state while connections clear.'}
              </div>
            </div>
          </div>

          {onRetry && (
            <button
              onClick={onRetry}
              className="btn-neutral"
              style={{ padding: '7px 14px', fontSize: '0.78rem', borderColor: 'rgba(255, 59, 107, 0.5)' }}
            >
              <RefreshCw size={13} />
              <span>Retry Sweep</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
