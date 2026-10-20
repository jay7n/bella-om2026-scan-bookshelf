"use client";

import { useState } from "react";
import {
  GENDERS,
  GRADES,
  INTERESTS,
  TRAITS,
  type Profile,
} from "@/lib/profile";

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export default function ProfileSheet({
  initial,
  onClose,
  onSave,
  onClear,
}: {
  initial: Profile;
  onClose: () => void;
  onSave: (p: Profile) => void;
  onClear: () => void;
}) {
  const [grade, setGrade] = useState(initial.grade ?? "");
  const [gender, setGender] = useState(initial.gender ?? "");
  const [traits, setTraits] = useState<string[]>(initial.traits ?? []);
  const [interests, setInterests] = useState<string[]>(initial.interests ?? []);
  const [note, setNote] = useState(initial.note ?? "");

  const save = () => {
    onSave({
      grade: grade || undefined,
      gender: gender || undefined,
      traits,
      interests,
      note: note.trim() || undefined,
    });
  };

  return (
    <>
      <div className="sheet-mask" onClick={onClose} />
      <div className="pf-sheet">
        <div className="sheet-grab" />
        <div className="pf-head">
          <h3>告诉我你是谁</h3>
          <p>填了之后，推荐会更合你的口味。只存在这台手机上。</p>
        </div>

        <div className="pf-body">
          <Field label="几年级">
            <div className="pf-chips">
              {GRADES.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`pf-chip ${grade === g ? "on" : ""}`}
                  onClick={() => setGrade(grade === g ? "" : g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </Field>

          <Field label="性别">
            <div className="pf-chips">
              {GENDERS.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`pf-chip ${gender === g ? "on" : ""}`}
                  onClick={() => setGender(gender === g ? "" : g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </Field>

          <Field label="我是什么样的" hint="可以多选">
            <div className="pf-chips">
              {TRAITS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`pf-chip ${traits.includes(t) ? "on" : ""}`}
                  onClick={() => setTraits(toggle(traits, t))}
                >
                  {t}
                </button>
              ))}
            </div>
          </Field>

          <Field label="我喜欢看" hint="可以多选">
            <div className="pf-chips">
              {INTERESTS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`pf-chip ${interests.includes(t) ? "on" : ""}`}
                  onClick={() => setInterests(toggle(interests, t))}
                >
                  {t}
                </button>
              ))}
            </div>
          </Field>

          <Field label="还想让我知道什么" hint="选填">
            <textarea
              className="pf-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 60))}
              placeholder="比如：我不喜欢太厚的书"
              rows={2}
            />
          </Field>
        </div>

        <div className="pf-actions">
          <button className="pf-clear" type="button" onClick={onClear}>
            清空
          </button>
          <button className="pf-save" type="button" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pf-field">
      <div className="pf-label">
        {label}
        {hint ? <span>{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
