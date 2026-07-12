import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, TextField, Input, Label } from "@heroui/react";

export default function App() {
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");

  async function greet(e: React.FormEvent) {
    e.preventDefault();
    setMsg(await invoke("greet", { name }));
  }

  return (
    <main className="flex flex-col items-center justify-center text-center px-4 pt-10">
      <h1 className="text-2xl font-bold mb-6">工单系统</h1>
      <form className="flex flex-col gap-3 w-full max-w-sm" onSubmit={greet}>
        <TextField>
          <Label>名称</Label>
          <Input
            placeholder="输入名称..."
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </TextField>
        <Button type="submit" fullWidth>
          提交
        </Button>
      </form>
      {msg && <p className="mt-6 text-lg font-medium">{msg}</p>}
    </main>
  );
}