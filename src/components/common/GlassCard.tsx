interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "well" | "dense" | "static";
}

const variantClass = {
  default: "glass",
  well: "glass-well",
  dense: "glass-dense",
  static: "glass-static",
};

export default function GlassCard({
  children,
  className = "",
  variant = "default",
}: GlassCardProps) {
  return (
    <div className={`${variantClass[variant]} p-5 ${className}`}>
      {children}
    </div>
  );
}
