#version 330

// West shader: sıcak renk düzenlemesi, bloom, film kontrastı, doygunluk ve kenar kararması.
// Minecraft'ın kendi efekt sistemiyle çalışır: OpenGL'de de Vulkan'da da.
uniform sampler2D InSampler;
uniform sampler2D BloomSampler;

in vec2 texCoord;

layout(std140) uniform SamplerInfo {
    vec2 OutSize;
    vec2 InSize;
};

layout(std140) uniform GradeConfig {
    float Strength;
};

out vec4 fragColor;

void main() {
    vec3 c = texture(InSampler, texCoord).rgb;
    vec3 b = texture(BloomSampler, texCoord).rgb;
    c += b * 0.32 * Strength;

    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // Gölgeler hafif serin, ışıklar sıcak (gün batımı tonu)
    vec3 graded = mix(c * vec3(0.95, 0.99, 1.06), c * vec3(1.08, 1.01, 0.90), smoothstep(0.15, 0.85, l));
    c = mix(c, graded, Strength);
    // Film eğrisi: yumuşak kontrast
    vec3 cc = clamp(c, 0.0, 1.0);
    c = mix(c, cc * cc * (3.0 - 2.0 * cc), 0.35 * Strength);
    // Doygunluk
    float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l2), c, 1.0 + 0.15 * Strength);
    // Kenar kararması
    vec2 d = texCoord - 0.5;
    c *= 1.0 - dot(d, d) * 0.6 * Strength;

    fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
