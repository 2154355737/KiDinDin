import { m } from "framer-motion";

const STEP_LABELS = ["设置", "选择", "确认", "执行", "补发"];

export function WorkflowSteps({ current }: { current: number }) {
  const marker = (step: number) => step === current
    ? <m.span
      key={step}
      className="current"
      aria-current="step"
      aria-label={`第 ${step} 步：${STEP_LABELS[step - 1]}`}
      layoutId="workflow-current-step"
      initial={{ opacity: 0.55, scale: 0.72 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 430, damping: 34 }}
    >{step}</m.span>
    : <span key={step} aria-label={`第 ${step} 步：${STEP_LABELS[step - 1]}`}>{step}</span>;

  return <nav className="stepper workflow-steps" aria-label={`批量提交进度：第 ${current} 步，共 ${STEP_LABELS.length} 步`}>
    {[1, 2, 3, 4, 5].flatMap((step) => step === 1
      ? [marker(step)]
      : [<i key={`line-${step}`} aria-hidden="true" />, marker(step)])}
    <em aria-hidden="true">{STEP_LABELS[current - 1]}</em>
  </nav>;
}
