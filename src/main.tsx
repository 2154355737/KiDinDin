import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LazyMotion, MotionConfig } from "framer-motion";
import App from "./App";

const loadMotionFeatures = () => import("./motionFeatures").then((module) => module.default);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LazyMotion features={loadMotionFeatures} strict>
      <MotionConfig
        reducedMotion="user"
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      >
        <App />
      </MotionConfig>
    </LazyMotion>
  </StrictMode>,
);
