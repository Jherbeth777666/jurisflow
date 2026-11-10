import { splitByVariables, variableLabel } from './variables'

/** Texto com variáveis {{...}} destacadas como chips. */
export function VariableText({ text }: { text: string }) {
  return (
    <>
      {splitByVariables(text).map((p, i) =>
        p.variable ? (
          <span
            key={i}
            title={variableLabel(p.text)}
            className="mx-px rounded bg-accent-50 px-1 py-px font-mono text-[0.92em] text-accent-700 ring-1 ring-inset ring-accent-200"
          >
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}
