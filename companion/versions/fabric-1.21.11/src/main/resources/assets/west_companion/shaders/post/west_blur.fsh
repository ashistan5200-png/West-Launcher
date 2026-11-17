#version 330

// West shader: parlak bölgeleri ayıklar ve tek yönde (Dir) yumuşak bulanıklaştırır (bloom için)
uniform sampler2D InSampler;

in vec2 texCoord;

layout(std140) uniform SamplerInfo {
    vec2 OutSize;
    vec2 InSize;
};

layout(std140) uniform BlurConfig {
    vec2 Dir;
    float Threshold;
};

out vec4 fragColor;

vec3 bright(vec3 c) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return c * smoothstep(Threshold, Threshold + 0.25, l);
}

void main() {
    vec2 px = Dir / InSize * 2.0;
    float w0 = 0.227027, w1 = 0.1945946, w2 = 0.1216216, w3 = 0.054054, w4 = 0.016216;
    vec3 acc = bright(texture(InSampler, texCoord).rgb) * w0;
    acc += (bright(texture(InSampler, texCoord + px).rgb) + bright(texture(InSampler, texCoord - px).rgb)) * w1;
    acc += (bright(texture(InSampler, texCoord + px * 2.0).rgb) + bright(texture(InSampler, texCoord - px * 2.0).rgb)) * w2;
    acc += (bright(texture(InSampler, texCoord + px * 3.0).rgb) + bright(texture(InSampler, texCoord - px * 3.0).rgb)) * w3;
    acc += (bright(texture(InSampler, texCoord + px * 4.0).rgb) + bright(texture(InSampler, texCoord - px * 4.0).rgb)) * w4;
    fragColor = vec4(acc, 1.0);
}
