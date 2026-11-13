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
            className="mx-px rounded-md bg-accent-50 px-1.5 text-label text-accent-700 ring-1 ring-inset ring-accent-200"
          >
            {variableLabel(p.text)}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}
