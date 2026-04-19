export interface MedicationRecord {
  id: string;
  user_id: string;
  medication_name: string;
  rxnorm_code: string | null;
  purpose: string | null;
  dosage: string | null;
  instructions: string | null;
  side_effects: string[] | null;
  raw_label_text: string | null;
  image_url: string | null;
  created_at: string;
}

interface MedicationCardProps {
  medication: MedicationRecord;
  showConfirmation?: boolean;
}

function Section({
  title,
  accentColor,
  children,
  animationClass,
}: {
  title: string;
  accentColor: string;
  children: React.ReactNode;
  animationClass?: string;
}) {
  return (
    <div
      className={animationClass}
      style={{ borderLeft: `4px solid ${accentColor}`, paddingLeft: "20px", marginBottom: "28px" }}
    >
      <h3
        style={{
          fontFamily: "var(--font-lora)",
          fontSize: "1rem",
          fontWeight: 700,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: "10px",
        }}
      >
        {title}
      </h3>
      <div style={{ color: "var(--text-primary)", fontWeight: 500, lineHeight: 1.7 }}>
        {children}
      </div>
    </div>
  );
}

export default function MedicationCard({
  medication,
  showConfirmation = false,
}: MedicationCardProps) {
  const formattedDate = new Date(medication.created_at).toLocaleDateString(
    "en-US",
    { year: "numeric", month: "long", day: "numeric" }
  );

  return (
    <article
      style={{
        backgroundColor: "var(--card-bg)",
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow-elevated)",
        overflow: "hidden",
        border: "1px solid var(--border)",
      }}
      aria-label={`Medication card for ${medication.medication_name}`}
    >
      <div
        className="animate-fade-up-1"
        style={{
          background: "linear-gradient(135deg, #1E6FD9 0%, #1558b0 100%)",
          padding: "28px 32px 24px",
          color: "#FFFFFF",
        }}
      >
        <div style={{ marginBottom: "6px" }}>
          <span style={{ fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", opacity: 0.8 }}>
            Medication
          </span>
        </div>
        <h2 style={{ fontFamily: "var(--font-lora)", fontSize: "1.9rem", fontWeight: 700, lineHeight: 1.2, marginBottom: "10px" }}>
          {medication.medication_name}
        </h2>
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          {medication.dosage && (
            <span style={{ backgroundColor: "rgba(255,255,255,0.18)", borderRadius: "20px", padding: "4px 14px", fontSize: "0.9rem", fontWeight: 600 }}>
              {medication.dosage}
            </span>
          )}
          {medication.rxnorm_code && (
            <span style={{ backgroundColor: "rgba(255,255,255,0.12)", borderRadius: "20px", padding: "4px 14px", fontSize: "0.82rem", fontWeight: 500, opacity: 0.85 }}>
              RxNorm: {medication.rxnorm_code}
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: "32px" }}>
        {medication.purpose && (
          <Section title="What this medication is for" accentColor="#1E6FD9" animationClass="animate-fade-up-2">
            <p style={{ fontSize: "1.05rem" }}>{medication.purpose}</p>
          </Section>
        )}

        {medication.instructions && (
          <Section title="How to take it" accentColor="#2F855A" animationClass="animate-fade-up-3">
            <p style={{ fontSize: "1.05rem" }}>{medication.instructions}</p>
          </Section>
        )}

        {medication.side_effects && medication.side_effects.length > 0 && (
          <Section title="Side effects to watch for" accentColor="#C05621" animationClass="animate-fade-up-4">
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
              {medication.side_effects.map((effect, index) => (
                <li
                  key={index}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    padding: "12px 16px",
                    backgroundColor: "var(--warning-light)",
                    borderRadius: "var(--radius)",
                    fontSize: "1rem",
                  }}
                >
                  <span style={{ color: "var(--warning)", fontWeight: 700, fontSize: "1rem", lineHeight: 1.6, flexShrink: 0 }} aria-hidden="true">
                    ▲
                  </span>
                  <span style={{ color: "var(--text-primary)" }}>{effect}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {showConfirmation && (
          <div
            style={{
              backgroundColor: "var(--success-light)",
              border: "1px solid #9AE6B4",
              borderRadius: "var(--radius)",
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              marginTop: "8px",
            }}
          >
            <span style={{ fontSize: "1.3rem" }} aria-hidden="true">✓</span>
            <div>
              <p style={{ color: "var(--success)", fontWeight: 700, fontSize: "1rem", margin: 0 }}>
                Added to your medication list
              </p>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem", margin: 0, marginTop: "2px" }}>
                Saved on {formattedDate}
              </p>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
